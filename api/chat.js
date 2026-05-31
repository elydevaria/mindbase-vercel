export const config = { maxDuration: 60 };

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";
const BRAVE_KEY = process.env.BRAVE_API_KEY;
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDDIT_USER_AGENT = "MindBase/1.0 (mental health practitioner tool)";

// ─── Brave Web Search ─────────────────────────────────────────────
async function braveSearch(query, count = 4) {
  try {
    const params = new URLSearchParams({
      q: query,
      count: String(count),
      country: "fr",
      search_lang: "fr",
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
    return (data.web?.results || []).slice(0, count)
      .map(r => `Titre: ${r.title}\nURL: ${r.url}\nExtrait: ${r.description?.slice(0, 150) || ""}`)
      .join("\n---\n");
  } catch (e) { return ""; }
}

// ─── Brave Video Search ───────────────────────────────────────────
async function braveVideoSearch(query, count = 4) {
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
      .map(r => `Titre: ${r.title}\nURL: ${r.url}\nExtrait: ${r.description?.slice(0, 120) || ""}`)
      .join("\n---\n");
  } catch (e) { return ""; }
}

// ─── PubMed API — free, no key needed ────────────────────────────
// Searches both most-cited (via sort=relevance which PubMed weights by citations)
// and most-recent separately, then merges and deduplicates
async function pubmedSearch(query) {
  try {
    const encoded = encodeURIComponent(query);
    const base = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils`;

    // Run two searches: most relevant (citation-weighted) + most recent
    const [relevantRes, recentRes] = await Promise.all([
      fetch(`${base}/esearch.fcgi?db=pubmed&term=${encoded}&retmax=5&sort=relevance&retmode=json`),
      fetch(`${base}/esearch.fcgi?db=pubmed&term=${encoded}&retmax=4&sort=pub+date&retmode=json&datetype=pdat&reldate=730`),
    ]);

    const [relevantData, recentData] = await Promise.all([
      relevantRes.json(),
      recentRes.json(),
    ]);

    // Merge IDs, deduplicate, keep max 7
    const relevantIds = relevantData?.esearchresult?.idlist || [];
    const recentIds = recentData?.esearchresult?.idlist || [];
    const allIds = [...new Set([...relevantIds, ...recentIds])].slice(0, 7);

    if (!allIds.length) return "";

    // Fetch summaries for all IDs
    const summaryRes = await fetch(
      `${base}/esummary.fcgi?db=pubmed&id=${allIds.join(",")}&retmode=json`
    );
    const summaryData = await summaryRes.json();
    const uids = summaryData?.result?.uids || [];

    return uids.map(id => {
      const paper = summaryData.result[id];
      if (!paper) return null;
      const authors = (paper.authors || []).slice(0, 3).map(a => a.name).join(", ");
      const year = paper.pubdate?.slice(0, 4) || "";
      const journal = paper.fulljournalname || paper.source || "";
      const isCited = relevantIds.includes(id);
      const isRecent = recentIds.includes(id);
      const tag = isCited && isRecent ? "[Cité + Récent]" : isCited ? "[Très cité]" : "[Récent 2023-2024]";
      return `Titre: ${tag} ${paper.title}\nURL: https://pubmed.ncbi.nlm.nih.gov/${id}/\nExtrait: ${authors}${year ? ` (${year})` : ""} — ${journal}`;
    }).filter(Boolean).join("\n---\n");

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
  const data = await res.json();
  return data.access_token;
}

async function redditOAuthSearch(query) {
  try {
    const token = await getRedditToken();
    const encoded = encodeURIComponent(query);
    const [srRes, postRes] = await Promise.all([
      fetch(`https://oauth.reddit.com/search?q=${encoded}&type=sr&limit=4&sort=relevance`, {
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": REDDIT_USER_AGENT },
      }),
      fetch(`https://oauth.reddit.com/search?q=${encoded}&type=link&limit=4&sort=relevance`, {
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": REDDIT_USER_AGENT },
      }),
    ]);
    const results = [];
    if (srRes.ok) {
      const d = await srRes.json();
      (d?.data?.children || []).slice(0, 3).forEach(s => {
        const r = s.data;
        if (r.display_name && (r.subscribers || 0) > 50)
          results.push(`Titre: r/${r.display_name} (${(r.subscribers||0).toLocaleString()} membres)\nURL: https://www.reddit.com/r/${r.display_name}\nExtrait: ${r.public_description?.slice(0, 120) || ""}`);
      });
    }
    if (postRes.ok) {
      const d = await postRes.json();
      (d?.data?.children || []).slice(0, 3).forEach(p => {
        const r = p.data;
        if (r.title && r.permalink)
          results.push(`Titre: ${r.title} (r/${r.subreddit})\nURL: https://www.reddit.com${r.permalink}\nExtrait: ${r.selftext?.slice(0, 120) || `r/${r.subreddit}`}`);
      });
    }
    return results.join("\n---\n");
  } catch (e) { return ""; }
}

async function redditSearch(queryFr, queryEn) {
  if (REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET) {
    const [fr, en] = await Promise.all([
      redditOAuthSearch(queryFr),
      redditOAuthSearch(queryEn),
    ]);
    const seen = new Set();
    return [...(fr ? fr.split("\n---\n") : []), ...(en ? en.split("\n---\n") : [])]
      .filter(r => { const m = r.match(/URL: (\S+)/); if (!m || seen.has(m[1])) return false; seen.add(m[1]); return true; })
      .join("\n---\n");
  } else {
    return braveSearch(`site:reddit.com ${queryFr} OR ${queryEn}`, 5);
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
        max_tokens: 600,
        temperature: 0.1,
        messages: [{
          role: "user",
          content: `Expert recherche web santé mentale française. Question: "${userMessage}"

JSON uniquement, pas de texte avant/après:
{
  "books": "requête livres France sur ce sujet",
  "videos": "requête YouTube français sur ce sujet",
  "reddit_fr": "2-3 mots français pour Reddit",
  "reddit_en": "2-3 mots anglais pour Reddit",
  "instagram": "termes et hashtags Instagram français sur ce sujet",
  "facebook": "noms groupes ou termes Facebook francophones sur ce sujet",
  "linkedin_kol": "noms de KEY OPINION LEADERS reconnus mondialement sur ce sujet en psychiatrie psychologie — cherche des professeurs, chefs de service, auteurs de guidelines, conférenciers internationaux (ex: Pr. Philip Asherson TDAH, Pr. Franck Bellivier psychiatrie France)",
  "linkedin_articles": "termes pour articles LinkedIn professionnels sur ce sujet santé mentale France",
  "forums": "termes pour forums médicaux professionnels FRANÇAIS sur ce sujet — doctissimo.fr, psychologies.com, psycom.org, forum-psychiatrie.fr, forum-tdah.fr, etc.",
  "protocols": "requête pour protocoles cliniques validés sur ce sujet — cherche: guidelines internationales, manuels de thérapie, échelles d'évaluation, outils cliniques (ex: CBT protocol PTSD, DBT manual borderline)",
  "pubmed_cited": "requête PubMed anglais pour les études les PLUS CITÉES sur ce sujet — utilise termes MeSH précis (ex: ADHD[MeSH] cognitive behavioral therapy meta-analysis)",
  "pubmed_recent": "requête PubMed anglais pour études RÉCENTES 2022-2025 sur ce sujet — termes précis",
  "official": "requête HAS ANSM OMS sur ce sujet",
  "general": "requête générale praticiens français sur ce sujet"
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
      books: `${t} livre france`,
      videos: `${t} youtube français`,
      reddit_fr: t, reddit_en: t,
      instagram: `${t} instagram praticien`,
      facebook: `${t} groupe facebook france`,
      linkedin_kol: `professeur psychiatre ${t} france key opinion leader`,
      linkedin_articles: `${t} article linkedin santé mentale france`,
      forums: `${t} forum discussion psychologie psychiatrie france`,
      protocols: `${t} clinical protocol guidelines therapy manual`,
      pubmed_cited: `${t} meta-analysis systematic review`,
      pubmed_recent: `${t} treatment 2023 2024 2025`,
      official: `${t} HAS ANSM recommandations`,
      general: `${t} santé mentale france praticien`,
    };
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, agent clinique expert en santé mentale pour praticiens français.
LANGUE : Français uniquement.

RÈGLE ABSOLUE : Utilise UNIQUEMENT les URLs exactes des résultats fournis. Ne génère jamais d'URL.
Si section vide : "Rechercher manuellement : [terme exact sur cette plateforme]"

FORMAT — dans cet ordre exact, sections pertinentes uniquement :
### 📋 Protocoles & Guidelines
### 🔬 Recherches clés (articles les plus cités)
### 🔬 Recherches récentes (2022-2025)
### 📄 Recommandations officielles
### 📚 Livres
### ▶️ Vidéos YouTube
### 🔗 LinkedIn — Key Opinion Leaders
### 📸 Instagram
### 👥 Facebook
### 💬 Reddit & Forums

Pour LinkedIn KOL : mentionne le titre académique, institution, et pourquoi ils sont une référence sur ce sujet.
Pour PubMed : indique [Très cité] ou [Récent] selon le tag fourni.
Par ressource : **titre en gras**, 1 phrase description, URL sur ligne suivante.
3 lignes max par ressource. Couvre TOUTES les sections disponibles.
Outil d'aide décisionnelle uniquement.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;

  try {
    const q = await generateSearchQueries(lastMessage);

    // ── Searches — PubMed uses free API (no Brave credits) ────────
    // Brave credits used: max 8 (7 if Reddit OAuth set)
    const [
      protocols,
      pubmed,
      official,
      books,
      videos,
      reddit,
      instagram,
      facebook,
      linkedin,
      forums,
      general,
    ] = await Promise.all([
      // 1 — Protocols: clinical guidelines, therapy manuals, evaluation tools
      braveSearch(
        `${q.protocols} (site:has-sante.fr OR site:nice.org.uk OR site:apa.org OR site:who.int OR clinical protocol guidelines "evidence-based")`,
        5
      ),

      // 0 Brave credits — PubMed direct API, both cited + recent
      pubmedSearch(`(${q.pubmed_cited}) OR (${q.pubmed_recent})`),

      // 1 — Official French/EU guidelines
      braveSearch(`${q.official} site:has-sante.fr OR site:ansm.sante.fr OR site:who.int OR site:ema.europa.eu`, 4),

      // 1 — Books on French bookstore sites
      braveSearch(`${q.books} site:amazon.fr OR site:fnac.com OR site:decitre.fr OR site:leslibraires.fr`),

      // 1 video credit — YouTube
      braveVideoSearch(q.videos),

      // 0 (OAuth) or 1 (Brave fallback) — Reddit
      redditSearch(q.reddit_fr, q.reddit_en),

      // 1 — Instagram
      braveSearch(`instagram.com ${q.instagram}`, 5),

      // 1 — Facebook groups
      braveSearch(`site:facebook.com groups ${q.facebook}`, 4),

      // 1 — LinkedIn: KOLs + articles
      // Target linkedin.com/in for profiles and linkedin.com/pulse for articles
      braveSearch(
        `(site:linkedin.com/in ${q.linkedin_kol} psychiatre OR psychologue OR professeur) OR (site:linkedin.com/pulse ${q.linkedin_articles})`,
        6
      ),

      // 1 — Professional French forums only, exclude social media
      braveSearch(
        `${q.forums} (site:doctissimo.fr OR site:psychologies.com OR site:psycom.org OR site:forum-psychiatrie.fr OR site:sante.journaldesfemmes.fr OR "forum" psychologie psychiatrie "santé mentale" france) -site:reddit.com -site:facebook.com -site:instagram.com -site:linkedin.com`,
        6
      ),

      // 1 — General
      braveSearch(q.general, 4),
    ]);

    const sections = [
      protocols  && `[PROTOCOLES & GUIDELINES CLINIQUES]\n${protocols}`,
      pubmed     && `[PUBMED — Articles cités & Recherches récentes]\n${pubmed}`,
      official   && `[RECOMMANDATIONS OFFICIELLES]\n${official}`,
      books      && `[LIVRES]\n${books}`,
      videos     && `[VIDÉOS YOUTUBE]\n${videos}`,
      linkedin   && `[LINKEDIN — Key Opinion Leaders & Articles]\n${linkedin}`,
      instagram  && `[INSTAGRAM]\n${instagram}`,
      facebook   && `[FACEBOOK]\n${facebook}`,
      reddit     && `[REDDIT]\n${reddit}`,
      forums     && `[FORUMS MÉDICAUX & PROFESSIONNELS]\n${forums}`,
      general    && `[GÉNÉRAL]\n${general}`,
    ].filter(Boolean);

    const augmentedMessages = [
      ...messages.slice(0, -1),
      {
        role: "user",
        content: `${lastMessage}

=== RÉSULTATS (${sections.length} sources) ===
${sections.join("\n\n===\n\n") || "Aucun résultat."}
=== FIN ===

RAPPEL : URLs exactes uniquement. Respecte l'ordre des sections. 3 lignes max par ressource. Couvre tout.`,
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
