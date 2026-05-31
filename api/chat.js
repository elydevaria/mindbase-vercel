export const config = { maxDuration: 60 };

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";
const BRAVE_KEY = process.env.BRAVE_API_KEY;
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDDIT_USER_AGENT = "MindBase/1.0 (mental health practitioner tool)";

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

// ─── Generate smart queries ───────────────────────────────────────
async function generateSearchQueries(userMessage) {
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
          content: `Tu es expert en recherche web pour des praticiens de santé mentale français.

Question : "${userMessage}"

Génère des requêtes optimisées. Règles importantes :
- Termes médicaux français corrects (TDAH, dépression, anxiété, TSPT, TCA, TOC, etc.)
- Pour Reddit : termes courts et directs (2-3 mots max)
- Pour PubMed : anglais médical précis avec termes MeSH si possible
- Pour Instagram : requête naturelle pour trouver des COMPTES POPULAIRES francophones sur ce sujet (praticiens, associations, pages de sensibilisation)
- Pour forums : pense aux forums médicaux français (Doctissimo, Psychologies, forums professionnels de psychiatrie/psychologie)

Réponds UNIQUEMENT avec ce JSON exact, sans texte avant ni après :
{
  "books": "requête pour livres sur ce sujet disponibles en France",
  "videos": "requête courte pour vidéos YouTube français sur ce sujet",
  "reddit_fr": "terme médical français court pour Reddit (2-3 mots)",
  "reddit_en": "terme médical anglais court pour Reddit (2-3 mots)",
  "forums": "requête pour forums médicaux et discussions professionnelles françaises sur ce sujet (hors Reddit)",
  "instagram": "terme médical principal en français pour trouver des comptes Instagram sur ce sujet — terme court et simple, juste le sujet médical (ex: TDAH, dépression, anxiété, autisme) sans rôle professionnel",
  "facebook": "requête pour groupes Facebook francophones sur ce sujet",
  "linkedin": "terme médical principal en français pour trouver des profils LinkedIn de praticiens sur ce sujet — terme court et simple comme le sujet médical (ex: TDAH, dépression, anxiété)",
  "recommendations": "requête bilingue pour recommandations ET protocoles — termes FR ET EN avec OR pour couvrir HAS + NICE + Cochrane + APA",
  "pubmed_cited": "requête PubMed anglais avec termes MeSH pour méta-analyses et systematic reviews (ex: 'ADHD[MeSH] meta-analysis systematic review')",
  "pubmed_recent": "requête PubMed anglais pour RCTs et études cliniques récentes 2022-2025",
}`
        }]
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no json");
    return JSON.parse(m[0]);
  } catch (e) {
    const t = userMessage.slice(0, 40);
    return {
      books: `${t} livre amazon fnac france`,
      videos: `${t} youtube français`,
      reddit_fr: t, reddit_en: t,
      forums: `${t} forum discussion professionnel france`,
      instagram: t,
      facebook: `${t} groupe facebook france`,
      linkedin: t,
      recommendations: `${t} recommandations HAS OR guidelines NICE OR Cochrane review`,
      pubmed_cited: `${t} meta-analysis systematic review`,
      pubmed_recent: `${t} randomized controlled trial 2023 2024`,
    };
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, agent clinique expert en santé mentale pour praticiens français.
LANGUE : Français uniquement.

RÈGLE ABSOLUE : Utilise UNIQUEMENT les URLs exactes des résultats fournis. Ne génère jamais d'URL.
Si section vide : "Rechercher manuellement : [terme exact]"

FORMAT — dans cet ordre, sections pertinentes uniquement :
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
Pour LinkedIn KOL : indique pourquoi ils sont influents (auteur de X, présent dans médias, etc.).
Pour Instagram : affiche EXACTEMENT le titre tel qu'il apparaît dans les résultats (ex: "Alice ♡ La Mini Coach TDAH") ET le handle (@username) sur la même ligne, puis la description et l'URL. Ne raccourcis jamais le nom du compte.
Pour LinkedIn : affiche le nom complet, titre et institution de la personne.
Pour Forums : max 5 résultats, uniquement forums médicaux/professionnels français.
Par ressource : **titre en gras**, 1 phrase description, URL sur ligne suivante. 3 lignes max.
Couvre TOUTES les sections disponibles. Outil d'aide décisionnelle uniquement.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;

  try {
    const q = await generateSearchQueries(lastMessage);

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

      // 1 — Recommendations + protocols, bilingual, multi-source
      braveSearch(
        `${q.recommendations} (site:has-sante.fr OR site:ansm.sante.fr OR site:nice.org.uk OR site:cochranelibrary.com OR site:apa.org OR site:who.int OR site:nimh.nih.gov OR site:inserm.fr OR site:sfpeada.fr)`,
        6
      ),

      // 0 credits — PubMed direct API, filters obituaries
      pubmedSearch(q.pubmed_cited, q.pubmed_recent),

      // 1 — Books
      braveSearch(`${q.books} site:amazon.fr OR site:fnac.com OR site:decitre.fr OR site:leslibraires.fr`),

      // 1 video credit
      braveVideoSearch(q.videos),

      // 0 (OAuth) or 1 (Brave fallback)
      redditSearch(q.reddit_fr, q.reddit_en),

      // 1 — Instagram: RESTORED to old working approach
      // site:instagram.com + natural language query finds popular accounts reliably
      braveSearch(`site:instagram.com ${q.instagram}`, 6),

      // 1 — Facebook groups
      braveSearch(`site:facebook.com ${q.facebook} groupe`, 5),

      braveSearch(`site:linkedin.com/in ${q.linkedin}`, 6),

      // 1 — French professional forums, max 5, no social media
      braveSearch(
        `${q.forums} (site:doctissimo.fr OR site:psychologies.com OR site:psycom.org OR site:forum-psychiatrie.fr OR site:soignants.com OR site:infirmiers.com OR site:jim.fr OR "forum" psychiatrie psychologie france) -site:reddit.com -site:facebook.com -site:instagram.com -site:linkedin.com`,
        5
      ),

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
    res.json({ reply });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
