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
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    
    // Safety check — ensure URL is valid before fetching
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    new URL(url); // throws if invalid

    const headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    };
    if (method === "POST") headers["Prefer"] = "return=representation";
    if (method === "PATCH") headers["Prefer"] = "return=representation";

    const res = await fetch(url, {
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

// ─── Local curated resources ─────────────────────────────────
// Simple, reliable — no Mistral, no failure risk
// Matches question against a hardcoded topic map
const CLINICAL_TOPICS = {
  tdah:         ["tdah","adhd","attention","hyperactivite","deficit"],
  depression:   ["depression","depressif","depressive","humeur"],
  anxiete:      ["anxiete","anxieux","angoisse","anxiété","trouble-anxieux"],
  tspt:         ["tspt","ptsd","trauma","traumatisme","emdr"],
  toc:          ["toc","ocd","obsessionnel","compulsif"],
  borderline:   ["borderline","tpb","bpd"],
  tca:          ["tca","anorexie","boulimie","hyperphagie"],
  schizophrenie:["schizophrenie","psychose","schizophrénique"],
  autisme:      ["autisme","tsa","neurodeveloppemental"],
  bipolaire:    ["bipolaire","maniaque","manie","bipolarite"],
  addiction:    ["addiction","dependance","alcool","cannabis","substance"],
  burnout:      ["burnout","burn-out","epuisement"],
};

function detectTopic(question) {
  const q = question.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [topic, keywords] of Object.entries(CLINICAL_TOPICS)) {
    if (keywords.some(k => q.includes(k))) return topic;
  }
  return null;
}

async function getLocalResources(question) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return "";

    const topic = detectTopic(question);
    process.stdout.write(`LOCAL DB: detected topic="${topic}"\n`);
    if (!topic) return "";

    const data = await supaFetch(
      "local_resources?order=quality.desc&limit=200&select=id,title,description,url,file_url,section,source,quality,topics"
    );

    if (!Array.isArray(data) || !data.length) return "";

    const variants = CLINICAL_TOPICS[topic] || [topic];
    const matches = data.filter(r =>
      (r.topics || []).some(t => {
        const nt = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/-/g, "");
        return variants.some(v => {
          const nv = v.replace(/-/g, "");
          return nt === nv || nt.includes(nv) || nv.includes(nt);
        });
      })
    );

    process.stdout.write(`LOCAL DB: ${matches.length} matches for "${topic}"\n`);
    if (!matches.length) return "";

    const grouped = {};
    matches.slice(0, 6).forEach(r => {
      const sec = r.section || "protocols";
      if (!grouped[sec]) grouped[sec] = [];
      const url = (r.url || r.file_url || "").replace(/\$\d+$/, "").trim();
      grouped[sec].push(`Titre: ✓ ${r.title} [RESSOURCE VÉRIFIÉE — ${r.source || "Curé"}]\nURL: ${url}\nExtrait: ${r.description || ""}`);
    });

    return Object.entries(grouped).map(([sec, items]) => {
      const label = { protocols:"RECOMMANDATIONS & PROTOCOLES", pubmed:"PUBMED", books:"LIVRES", videos:"VIDÉOS YOUTUBE" }[sec] || sec.toUpperCase();
      return `[${label} — RESSOURCES VÉRIFIÉES MindBase]\n${items.join("\n---\n")}`;
    }).join("\n\n===\n\n");

  } catch (e) {
    process.stdout.write("LOCAL DB ERROR: " + e.message + "\n");
    return "";
  }
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
    process.stdout.write(`BRAVE: status=${res.status} results=${data.web?.results?.length || 0} query="${query.slice(0,60)}"\n`);
    if (data.type === "ErrorResponse") {
      process.stdout.write(`BRAVE ERROR RESPONSE: ${JSON.stringify(data)}\n`);
      return "";
    }
    const results = [];
    (data.web?.results || []).slice(0, count).forEach(r => {
      results.push(`Titre: ${r.title}\nURL: ${r.url}\nExtrait: ${r.description?.slice(0, 200) || ""}`);
    });
    return results.join("\n---\n");
  } catch (e) {
    process.stdout.write("BRAVE ERROR: " + e.message + "\n");
    return "";
  }
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
  "pubmed_cited": "requête PubMed EN ANGLAIS avec termes MeSH précis pour méta-analyses et systematic reviews les plus citées — ex: major depressive disorder[MeSH] meta-analysis OR ADHD[MeSH] systematic review",
  "pubmed_recent": "requête PubMed EN ANGLAIS pour essais randomisés récents 2022-2025 — ex: major depressive episode treatment randomized controlled trial 2023"
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
Par ressource, utilise EXACTEMENT ce format (ne pas écrire les mots "titre en gras") :
**[Titre de la ressource]**
[Une phrase de description.]
[URL exacte]
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

    // ── Step 0: Mistral decides: search resources OR answer directly ─
    const routeRes = await fetch(MISTRAL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        max_tokens: 5,
        temperature: 0,
        messages: [
          { role: "system", content: `Tu es un routeur. Lis la conversation et réponds UNIQUEMENT par "search" ou "answer".
"search" = l'utilisateur cherche des ressources/protocoles/articles/livres/communautés sur un sujet clinique.
"answer" = l'utilisateur veut une reformulation, synthèse, explication, définition, comparaison, ou envoie un texte à traiter.` },
          ...messages.slice(-6),
        ]
      }),
    });
    const routeData = await routeRes.json();
    // Force search if user explicitly asks for resources
    const forceSearch = /cherche.moi|recherche.*ressources|ressources cliniques/i.test(lastMessage);
    const route = forceSearch ? "search" : ((routeData.choices?.[0]?.message?.content || "search").toLowerCase().includes("answer") ? "answer" : "search");

    // If resource search triggered from conversational context,
    // extract clean topic from conversation history and use as effective query
    if (forceSearch && messages.length > 1) {
      const topicRes = await fetch(MISTRAL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}` },
        body: JSON.stringify({
          model: "mistral-small-latest",
          max_tokens: 20,
          temperature: 0,
          messages: [
            { role: "system", content: "Identifie le sujet clinique principal en 3-5 mots maximum. Court et précis. Exemples: 'épisode dépressif adulte', 'TDAH adulte', 'trouble anxieux généralisé', 'schizophrénie diagnostic'. Réponds UNIQUEMENT avec ces mots, rien d'autre." },
            ...messages.slice(-10),
          ]
        })
      });
      const topicData = await topicRes.json();
      const extractedTopic = topicData.choices?.[0]?.message?.content?.trim().replace(/^["'«»]+|["'«»]+$/g, "");
      if (extractedTopic) {
        messages[messages.length - 1] = { role: "user", content: `Ressources sur ${extractedTopic}` };
        process.stdout.write(`TOPIC EXTRACTED: "${extractedTopic}"\n`);
        // Store extracted topic to return with response
        req._extractedTopic = extractedTopic;
      }
    }
    process.stdout.write(`ROUTE: ${route}\n`);

    if (route === "answer") {
      process.stdout.write("CONVERSATIONAL — skipping searches\n");
      const convResponse = await fetch(MISTRAL_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          messages: [
            { role: "system", content: `Tu es MindBase, assistant clinique expert en santé mentale pour praticiens français.
Réponds directement à la demande en utilisant le contexte de la conversation.
- Texte à synthétiser/reformuler → fais-le directement
- Question conceptuelle → réponds avec tes connaissances cliniques
- Pas assez de contexte → demande poliment ce qu'il faut traiter
Toujours en français, concis et précis.` },
            ...messages.slice(-10),
          ],
          max_tokens: 2000,
          temperature: 0.3,
        }),
      });
      const convData = await convResponse.json();
      const convReply = convData.choices?.[0]?.message?.content || "Je n'ai pas pu générer une réponse.";
      const withOffer = convReply + "\n\n---\n*Souhaitez-vous que je recherche des **ressources cliniques** sur ce sujet ?*";
      return res.json({ reply: withOffer, conversational: true });
    }

    // ── Step 1: Always run local DB first (0 credits, always fresh) ─
    const earlyLocal = await getLocalResources(lastMessage);

    // ── Step 2: Check query cache ──────────────────────────────────
    const dbResult = await getFromDatabase(lastMessage);
    if (dbResult && !dbResult.stale && dbResult.fromDb) {
      process.stdout.write(`CACHE HIT — local injected: ${!!earlyLocal}\n`);
      const reply = earlyLocal
        ? `### ✅ Ressources vérifiées MindBase\n${earlyLocal.split("\n\n===\n\n").map(s => s.replace(/\[[^\]]+\]\n/, "")).join("\n\n")}\n\n---\n\n` + dbResult.result
        : dbResult.result;
      return res.json({ reply, source: "database" });
    }
    const staleId = dbResult?.stale ? dbResult.id : null;

    // ── Step 3: Intent detection + query generation ───────────────
    const { sections: intentSections, queries: q } = await generateQueriesAndIntent(lastMessage);
    const ALL_SECTIONS = ["protocols","pubmed","books","videos","instagram","facebook","linkedin","reddit","forums"];
    const isGeneral = intentSections.length === 0;
    const has = (s) => isGeneral || intentSections.includes(s);
    const baseCount = isGeneral ? 5 : intentSections.length <= 2 ? 10 : 7;
    const protocolCount = has('protocols') && !isGeneral ? 10 : baseCount;

    // ── Extract keywords for local DB lookup ────────────────────
    // Simple keyword extraction from the question
    // Extract keywords — include both normalized words AND original acronyms (TDAH, TCA etc)
    const acronyms = lastMessage.match(/\b[A-Z]{2,5}\b/g) || [];
    const keywords = [
      ...acronyms.map(a => a.toLowerCase()),
      ...lastMessage
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 3)
        .filter(w => !["pour","dans","avec","cette","quel","quels","quelle","quelles","comment","trouver","chercher","donne","moi","les","des","une","sur","par","que","qui","est","sont","plus","aussi","mais","avoir","faire","ressources","completes","complètes","livres","videos","réseaux","sociaux","recherches","protocoles"].includes(w))
    ].filter((w, i, arr) => arr.indexOf(w) === i).slice(0, 8);

    process.stdout.write("KEYWORDS: " + JSON.stringify(keywords) + "\n");
    process.stdout.write("INTENT: " + JSON.stringify(intentSections) + "\n");
    process.stdout.write("QUERY recommendations: " + JSON.stringify(q.recommendations?.slice(0,60)) + "\n");

    // ── Local curated resources — always runs, 0 API credits ────
    const localResults = earlyLocal; // reuse already fetched local results

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
      // protocols: run both searches then merge
      has("protocols") ? braveSearch(
        `${q.recommendations} (site:has-sante.fr OR site:ameli.fr OR site:inserm.fr OR site:ansm.sante.fr OR site:nice.org.uk OR site:cochranelibrary.com OR site:who.int)`,
        protocolCount
      ).then(async (main) => {
        const ameli = await braveSearch(`${q.reddit_fr} site:ameli.fr`, 5);
        const seen = new Set();
        return [...(ameli ? ameli.split("\n---\n") : []), ...(main ? main.split("\n---\n") : [])]
          .filter(r => { const m = r.match(/URL: (\S+)/); if (!m || seen.has(m[1])) return false; seen.add(m[1]); return true; })
          .join("\n---\n");
      }).catch(() => braveSearch(
        `${q.recommendations} (site:has-sante.fr OR site:ameli.fr OR site:inserm.fr OR site:ansm.sante.fr OR site:nice.org.uk)`,
        protocolCount
      )) : Promise.resolve(""),
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
      localResults    && `[RESSOURCES VÉRIFIÉES MindBase]\n${localResults}`,
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

=== DÉBUT RÉSULTATS (${sections.length} sources) ===
${sections.join("\n\n---\n\n") || "Aucun résultat."}
=== FIN RÉSULTATS ===

RAPPEL : URLs exactes. Respecte l'ordre. Min 5 PubMed. Max 5 Forums. 2 lignes max par ressource. Couvre TOUTES les sections sans exception.`,
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
        max_tokens: 6000,
        temperature: 0.2,
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const reply = data.choices?.[0]?.message?.content || "Aucun résultat.";
    const extractedTopic = req._extractedTopic || null;

    // ── Step 3: Store result in database ────────────────────────
    try {
      await storeInDatabase(lastMessage, reply, intentSections, staleId);
    } catch (e) {
      process.stdout.write("STORE FAILED: " + e.message + "\n");
    }

    res.json({ reply, extractedTopic });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
