export const config = { maxDuration: 60 };

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";
const BRAVE_KEY = process.env.BRAVE_API_KEY;
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDDIT_USER_AGENT = "MindBase/1.0 (mental health practitioner tool)";

// ─── Supabase helpers ─────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

async function supaFetch(path, method = "GET", body) {
  try {
    const headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    };
    if (method === "POST") headers["Prefer"] = "return=representation";
    if (method === "PATCH") headers["Prefer"] = "return=representation";

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    process.stdout.write(`SUPA ${method} ${path.slice(0,40)} → ${res.status}\n`);
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    process.stdout.write("SUPA ERROR: " + e.message + "\n");
    return null;
  }
}

// Normalize question to a consistent hash key
// "Protocoles TCC pour l'anxiété ?" → "protocoles tcc pour l anxiete"
function normalizeQuery(q) {
  return q
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9 ]/g, " ")                        // remove punctuation
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

// ─── Database lookup ──────────────────────────────────────────────
// Checks if we have a stored result for this query
// Returns: { result, sections, fromDb: true } or null
async function getFromDatabase(question) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    const hash = normalizeQuery(question);
    const data = await supaFetch(
      `query_database?query_hash=eq.${encodeURIComponent(hash)}&limit=1&select=id,result,sections,hit_count,last_searched`
    );
    if (!Array.isArray(data) || data.length === 0) return null;

    const entry = data[0];

    // Check freshness — stable content (protocols, books) valid 7 days
    // Dynamic content (forums, reddit) valid 1 day
    const ageHours = (Date.now() - new Date(entry.last_searched).getTime()) / 3600000;
    const sections = entry.sections || [];
    const hasDynamicSections = sections.some(s => ["reddit","forums","instagram"].includes(s));
    const maxAge = hasDynamicSections ? 24 : 168; // 1 day or 7 days

    if (ageHours > maxAge) {
      // Entry is stale — will refresh but keep the id for update
      return { stale: true, id: entry.id, sections };
    }

    // Increment hit count asynchronously (don't wait)
    supaFetch(
      `query_database?id=eq.${entry.id}`,
      "PATCH",
      { hit_count: entry.hit_count + 1 }
    ).catch(() => {});

    process.stdout.write(`DB HIT: ${hash.slice(0, 50)} (${entry.hit_count} hits, ${Math.round(ageHours)}h old)\n`);
    return { result: entry.result, sections, fromDb: true };
  } catch (e) {
    process.stdout.write("DB LOOKUP ERROR: " + e.message + "\n");
    return null;
  }
}

// ─── Database store ───────────────────────────────────────────────
async function storeInDatabase(question, result, sections, existingId = null) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    const hash = normalizeQuery(question);
    const now = new Date().toISOString();

    if (existingId) {
      // Update stale entry
      await supaFetch(`query_database?id=eq.${existingId}`, "PATCH", {
        result,
        sections,
        last_searched: now,
      });
      process.stdout.write(`DB UPDATED: ${hash.slice(0, 50)}\n`);
    } else {
      // Insert new entry
      await supaFetch("query_database", "POST", {
        query_hash: hash,
        question,
        result,
        sections,
        last_searched: now,
      });
      process.stdout.write(`DB STORED: ${hash.slice(0, 50)}\n`);
    }
  } catch (e) {
    process.stdout.write("DB STORE ERROR: " + e.message + "\n");
  }
}



// ─── Brave Web Search ─────────────────────────────────────────────
async function braveSearch(query, count = 5) {
  try {
    const params = new URLSearchParams({
      q: query,
      count: String(count),
      country: "fr",
      search_lang: "fr",
      ui_lang: "fr-FR",
      safesearch: "moderate",
      text_decorations: "false",
    });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_KEY,
      },
    });
    const data = await res.json();
    const results = [];
    (data.web?.results || []).slice(0, count).forEach(r => {
      results.push(`Titre: ${r.title}\nURL: ${r.url}\nExtrait: ${r.description?.slice(0, 200) || ""}`);
    });
    return results.join("\n---\n");
  } catch (e) { return ""; }
}

// ─── Brave Video Search ───────────────────────────────────────────
async function braveVideoSearch(query, count = 5) {
  try {
    const params = new URLSearchParams({
      q: query,
      count: String(count),
      country: "fr",
      search_lang: "fr",
    });
    const res = await fetch(`https://api.search.brave.com/res/v1/videos/search?${params}`, {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_KEY,
      },
    });
    const data = await res.json();
    return (data.results || []).slice(0, count)
      .map(r => `Titre: ${r.title}\nURL: ${r.url}\nExtrait: ${r.description?.slice(0, 150) || ""}`)
      .join("\n---\n");
  } catch (e) { return ""; }
}

// ─── PubMed API — free, no Brave credits ─────────────────────────
async function pubmedSearch(citedQuery, recentQuery) {
  try {
    const base = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils`;

    const [relevantRes, recentRes] = await Promise.all([
      fetch(`${base}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(citedQuery)}&retmax=8&sort=relevance&retmode=json`),
      fetch(`${base}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(recentQuery)}&retmax=5&sort=pub+date&retmode=json&datetype=pdat&reldate=730`),
    ]);
    const [relevantData, recentData] = await Promise.all([relevantRes.json(), recentRes.json()]);
    const relevantIds = relevantData?.esearchresult?.idlist || [];
    const recentIds = recentData?.esearchresult?.idlist || [];
    const allIds = [...new Set([...relevantIds, ...recentIds])].slice(0, 12);
    if (!allIds.length) return "";

    const summaryRes = await fetch(`${base}/esummary.fcgi?db=pubmed&id=${allIds.join(",")}&retmode=json`);
    const summaryData = await summaryRes.json();

    // Filter out non-research content
    const SKIP_TITLES = ["obituary", "in memoriam", "erratum", "correction", "retraction", "author reply"];
    const SKIP_TYPES = ["obituary", "published erratum", "retracted publication", "comment", "letter"];

    const filtered = (summaryData?.result?.uids || []).map(id => {
      const p = summaryData.result[id];
      if (!p) return null;
      const titleLower = p.title?.toLowerCase() || "";
      const pubtypes = (p.pubtype || []).map(t => t.toLowerCase());
      if (SKIP_TITLES.some(s => titleLower.includes(s))) return null;
      if (SKIP_TYPES.some(s => pubtypes.includes(s))) return null;
      const authors = (p.authors || []).slice(0, 3).map(a => a.name).join(", ");
      const year = p.pubdate?.slice(0, 4) || "";
      const journal = p.fulljournalname || p.source || "";
      const isCited = relevantIds.includes(id);
      const isRecent = recentIds.includes(id);
      const tag = isCited && isRecent ? "[Cité + Récent]" : isCited ? "[Très cité]" : "[Récent]";
      return `Titre: ${tag} ${p.title}\nURL: https://pubmed.ncbi.nlm.nih.gov/${id}/\nExtrait: ${authors}${year ? ` (${year})` : ""} — ${journal}`;
    }).filter(Boolean);

    return filtered.join("\n---\n");
  } catch (e) { return ""; }
}

// ─── Reddit OAuth or Brave fallback ───────────────────────────────
async function getRedditToken() {
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": REDDIT_USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });
  return (await res.json()).access_token;
}

async function redditOAuthSearch(query) {
  try {
    const token = await getRedditToken();
    const encoded = encodeURIComponent(query);
    const [srRes, postRes] = await Promise.all([
      fetch(`https://oauth.reddit.com/search?q=${encoded}&type=sr&limit=5&sort=relevance`, {
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": REDDIT_USER_AGENT },
      }),
      fetch(`https://oauth.reddit.com/search?q=${encoded}&type=link&limit=5&sort=relevance`, {
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": REDDIT_USER_AGENT },
      }),
    ]);
    const results = [];
    if (srRes.ok) {
      const d = await srRes.json();
      (d?.data?.children || []).slice(0, 3).forEach(s => {
        const r = s.data;
        if (r.display_name && (r.subscribers || 0) > 50)
          results.push(`Titre: r/${r.display_name} — ${r.title || r.display_name} (${(r.subscribers||0).toLocaleString()} membres)\nURL: https://www.reddit.com/r/${r.display_name}\nExtrait: ${r.public_description?.slice(0, 150) || "Communauté Reddit"}`);
      });
    }
    if (postRes.ok) {
      const d = await postRes.json();
      (d?.data?.children || []).slice(0, 4).forEach(p => {
        const r = p.data;
        if (r.title && r.permalink)
          results.push(`Titre: ${r.title} (r/${r.subreddit})\nURL: https://www.reddit.com${r.permalink}\nExtrait: ${r.selftext?.slice(0, 150) || `Discussion dans r/${r.subreddit}`}`);
      });
    }
    return results.join("\n---\n");
  } catch (e) { return ""; }
}

async function redditSearch(queryFr, queryEn) {
  if (REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET) {
    const [fr, en] = await Promise.all([redditOAuthSearch(queryFr), redditOAuthSearch(queryEn)]);
    const seen = new Set();
    return [...(fr ? fr.split("\n---\n") : []), ...(en ? en.split("\n---\n") : [])]
      .filter(r => { const m = r.match(/URL: (https?:\/\/\S+)/); if (!m || seen.has(m[1])) return false; seen.add(m[1]); return true; })
      .join("\n---\n");
  } else {
    const [fr, en] = await Promise.all([
      braveSearch(`site:reddit.com ${queryFr}`, 5),
      braveSearch(`site:reddit.com ${queryEn}`, 5),
    ]);
    const seen = new Set();
    return [...(fr ? fr.split("\n---\n") : []), ...(en ? en.split("\n---\n") : [])]
      .filter(r => { const m = r.match(/URL: (https?:\/\/\S+)/); if (!m || seen.has(m[1])) return false; seen.add(m[1]); return true; })
      .join("\n---\n");
  }
}

// ─── Combined: intent detection + query generation (single Mistral call) ────
async function generateQueriesAndIntent(userMessage) {
  const ALL_SECTIONS = ["protocols","pubmed","books","videos","instagram","facebook","linkedin","reddit","forums"];
  try {
    const res = await fetch(MISTRAL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        max_tokens: 700,
        temperature: 0.1,
        messages: [{
          role: "user",
          content: `Tu es expert en recherche web pour praticiens de santé mentale français.

Question: "${userMessage}"

Réponds UNIQUEMENT avec ce JSON exact (pas de texte avant ni après):
{
  "sections": ["liste des sections pertinentes parmi: protocols, pubmed, books, videos, instagram, facebook, linkedin, reddit, forums"],
  "books": "requête livres France",
  "videos": "requête YouTube français",
  "reddit_fr": "2-3 mots français pour Reddit",
  "reddit_en": "2-3 mots anglais pour Reddit",
  "instagram": "terme court pour comptes Instagram francophones",
  "facebook": "termes groupes Facebook francophones",
  "linkedin": "terme court pour profils LinkedIn praticiens",
  "forums": "termes forums médicaux professionnels français",
  "recommendations": "requête bilingue HAS ANSM NICE Cochrane APA",
  "pubmed_cited": "requête PubMed MeSH pour études citées",
  "pubmed_recent": "requête PubMed études récentes 2022-2025"
}

Règles pour "sections" :
- Question sur protocoles/traitements/thérapies → inclure ["protocols","pubmed"] au minimum
- Question sur livres → ["books"]
- Question sur Instagram → ["instagram"]
- Question sur réseaux sociaux → ["instagram","facebook","linkedin","reddit"]
- Question sur communautés/forums → ["reddit","forums","facebook"]
- Question sur recherches/études → ["pubmed"]
- Question générale ou "ressources complètes" → toutes les sections
- Analyse intelligemment selon le contexte clinique`
        }]
      }),
    });

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no json");
    const parsed = JSON.parse(match[0]);

    // Fuzzy validate sections — map close matches to canonical names
    const SECTION_MAP = {
      "protocols": "protocols", "protocol": "protocols", "recommandations": "protocols",
      "recommendation": "protocols", "guidelines": "protocols", "guideline": "protocols",
      "pubmed": "pubmed", "research": "pubmed", "recherche": "pubmed", "studies": "pubmed",
      "books": "books", "book": "books", "livres": "books", "livre": "books",
      "videos": "videos", "video": "videos", "youtube": "videos", "vidéos": "videos",
      "instagram": "instagram", "ig": "instagram",
      "facebook": "facebook", "fb": "facebook",
      "linkedin": "linkedin",
      "reddit": "reddit",
      "forums": "forums", "forum": "forums", "discussions": "forums",
    };
    const rawSections = parsed.sections || [];
    const sections = [...new Set(
      rawSections.map(s => SECTION_MAP[s.toLowerCase()] || (ALL_SECTIONS.includes(s) ? s : null))
        .filter(Boolean)
    )];
    process.stdout.write("INTENT RAW: " + JSON.stringify(rawSections) + " → MAPPED: " + JSON.stringify(sections) + "\n");

    return { queries: parsed, sections };
  } catch (e) {
    process.stdout.write("INTENT ERROR: " + e.message + "\n");
    // Keyword fallback — better than showing everything
    const m = userMessage.toLowerCase();
    const t = userMessage.slice(0, 40);
    let fallbackSections = [];
    if (/protocole|guideline|recommandation|traitement|th[eé]rapie|prise en charge/.test(m)) fallbackSections = ["protocols","pubmed"];
    else if (/livre|book|manuel|fnac|amazon/.test(m)) fallbackSections = ["books"];
    else if (/instagram|ig/.test(m)) fallbackSections = ["instagram"];
    else if (/youtube|vid[eé]o/.test(m)) fallbackSections = ["videos"];
    else if (/forum|discussion|communaut[eé]/.test(m)) fallbackSections = ["reddit","forums","facebook"];
    else if (/r[eé]seau|social/.test(m)) fallbackSections = ["instagram","facebook","linkedin","reddit"];
    else if (/recherche|[eé]tude|pubmed|article/.test(m)) fallbackSections = ["pubmed"];
    else if (/linkedin/.test(m)) fallbackSections = ["linkedin"];
    // If still empty → run all (truly general query)
    return {
      sections: fallbackSections,
      queries: {
        books: t + " livre france",
        videos: t + " youtube français",
        reddit_fr: t, reddit_en: t,
        instagram: t + " praticien",
        facebook: t + " groupe france",
        linkedin: t + " praticien",
        forums: t + " forum france",
        recommendations: t + " recommandations HAS OR guidelines NICE",
        pubmed_cited: t + " meta-analysis systematic review",
        pubmed_recent: t + " treatment 2023 2024",
      }
    };
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, agent clinique expert en santé mentale pour praticiens français.
LANGUE : Français uniquement.

RÈGLES ABSOLUES :
1. Utilise UNIQUEMENT les URLs exactes des résultats fournis entre les marqueurs === ===
2. N'affiche UNE SECTION que si elle contient des résultats réels dans les données fournies
3. Si une section n'a AUCUN résultat dans les données → NE L'AFFICHE PAS DU TOUT, même pas le titre
4. Ne génère JAMAIS une URL de toi-même
5. Ne complète JAMAIS avec tes propres connaissances si les données sont vides pour une section

FORMAT — dans cet ordre, UNIQUEMENT si la section a des données réelles :
### 🔬 Articles les plus cités (minimum 5)
### 🔬 Recherches récentes (2022-2025)
### 📄 Recommandations & Protocoles
### 📚 Livres
### ▶️ Vidéos YouTube
### 🔗 LinkedIn — Key Opinion Leaders
### 📸 Instagram
### 👥 Facebook
### 💬 Reddit
### 💬 Forums professionnels

Pour Articles les plus cités : affiche MINIMUM 5 articles tagués [Très cité], [Récent] ou [Cité + Récent].
Pour Instagram : affiche EXACTEMENT le titre tel qu'il apparaît dans les résultats ET le handle (@username). Ne raccourcis jamais le nom du compte.
Pour LinkedIn : affiche le nom complet, titre et institution de la personne.
Pour Forums : max 5 résultats, uniquement forums médicaux/professionnels français.
Par ressource : **titre en gras**, 1 phrase description, URL sur ligne suivante. 3 lignes max.
Si seulement 1-2 sections ont des résultats, affiche-les en détail complet sans limite de lignes.
Outil d'aide décisionnelle uniquement.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;

  try {
    // ── Step 0: Verify Supabase connection ───────────────────────
    process.stdout.write(`SUPABASE_URL set: ${!!process.env.SUPABASE_URL}\n`);
    process.stdout.write(`SUPABASE_KEY set: ${!!process.env.SUPABASE_ANON_KEY}\n`);

    // ── Step 1: Check database first ──────────────────────────────
    const dbResult = await getFromDatabase(lastMessage);
    if (dbResult && !dbResult.stale && dbResult.fromDb) {
      return res.json({ reply: dbResult.result, source: "database" });
    }
    const staleId = dbResult?.stale ? dbResult.id : null;

    // ── Step 2: Intent detection + query generation ───────────────
    const { sections: intentSections, queries: q } = await generateQueriesAndIntent(lastMessage);
    const ALL_SECTIONS = ["protocols","pubmed","books","videos","instagram","facebook","linkedin","reddit","forums"];
    const isGeneral = intentSections.length === 0;
    const has = (s) => isGeneral || intentSections.includes(s);
    const baseCount = isGeneral ? 5 : intentSections.length <= 2 ? 8 : 6;

    // ── Run only relevant searches in parallel ────────────────────
    const [
      recommendations,
      pubmed,
      books,
      videos,
      reddit,
      instagram,
      facebook,
      linkedin,
      forums,
    ] = await Promise.all([
      has("protocols") ? braveSearch(
        `${q.recommendations} (site:has-sante.fr OR site:ansm.sante.fr OR site:nice.org.uk OR site:cochranelibrary.com OR site:apa.org OR site:who.int OR site:nimh.nih.gov OR site:inserm.fr OR site:sfpeada.fr)`,
        baseCount
      ) : Promise.resolve(""),
      has("pubmed") ? pubmedSearch(q.pubmed_cited, q.pubmed_recent) : Promise.resolve(""),
      has("books") ? braveSearch(
        `${q.books} site:amazon.fr OR site:fnac.com OR site:decitre.fr OR site:leslibraires.fr`,
        baseCount
      ) : Promise.resolve(""),
      has("videos") ? braveVideoSearch(q.videos, baseCount) : Promise.resolve(""),
      has("reddit") ? redditSearch(q.reddit_fr, q.reddit_en) : Promise.resolve(""),
      has("instagram") ? braveSearch(
        `site:instagram.com ${q.instagram}`,
        baseCount
      ) : Promise.resolve(""),
      has("facebook") ? braveSearch(
        `site:facebook.com ${q.facebook} groupe`,
        baseCount
      ) : Promise.resolve(""),
      has("linkedin") ? braveSearch(
        `${q.linkedin} (site:linkedin.com/in OR "profil linkedin")`,
        baseCount
      ) : Promise.resolve(""),
      has("forums") ? braveSearch(
        `${q.forums} forum OR discussion OR communauté france -site:reddit.com -site:facebook.com -site:instagram.com -site:linkedin.com -site:twitter.com -site:youtube.com`,
        baseCount
      ) : Promise.resolve(""),
    ]);

    const sections = [
      pubmed          && `[PUBMED — Articles cités & Recherches récentes]\n${pubmed}`,
      recommendations && `[RECOMMANDATIONS & PROTOCOLES]\n${recommendations}`,
      books           && `[LIVRES]\n${books}`,
      videos          && `[VIDÉOS YOUTUBE]\n${videos}`,
      linkedin        && `[LINKEDIN — Key Opinion Leaders]\n${linkedin}`,
      instagram       && `[INSTAGRAM]\n${instagram}`,
      facebook        && `[FACEBOOK]\n${facebook}`,
      reddit          && `[REDDIT]\n${reddit}`,
      forums          && `[FORUMS MÉDICAUX & PROFESSIONNELS]\n${forums}`,
    ].filter(Boolean);

    const augmentedMessages = [
      ...messages.slice(0, -1),
      {
        role: "user",
        content: `${lastMessage}

=== RÉSULTATS (${sections.length} sources) ===
${sections.join("\n\n===\n\n") || "Aucun résultat."}
=== FIN ===

RAPPEL : URLs exactes uniquement. Respecte l'ordre. Min 5 articles PubMed. Max 5 Forums. 3 lignes max. Couvre tout.`,
      },
    ];

    const response = await fetch(MISTRAL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...augmentedMessages.slice(-14),
        ],
        max_tokens: 4000,
        temperature: 0.2,
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const reply = data.choices?.[0]?.message?.content || "Aucun résultat.";

    // ── Step 3: Store result in database ────────────────────────
    try {
      await storeInDatabase(lastMessage, reply, intentSections, staleId);
    } catch (e) {
      process.stdout.write("STORE FAILED: " + e.message + "\n");
    }

    res.json({ reply });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
