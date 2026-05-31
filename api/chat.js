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

// ─── PubMed API — free, no Brave credits ─────────────────────────
async function pubmedSearch(citedQuery, recentQuery) {
  try {
    const base = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils`;
    const [relevantRes, recentRes] = await Promise.all([
      fetch(`${base}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(citedQuery)}&retmax=5&sort=relevance&retmode=json`),
      fetch(`${base}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(recentQuery)}&retmax=4&sort=pub+date&retmode=json&datetype=pdat&reldate=730`),
    ]);
    const [relevantData, recentData] = await Promise.all([relevantRes.json(), recentRes.json()]);
    const relevantIds = relevantData?.esearchresult?.idlist || [];
    const recentIds = recentData?.esearchresult?.idlist || [];
    const allIds = [...new Set([...relevantIds, ...recentIds])].slice(0, 8);
    if (!allIds.length) return "";
    const summaryRes = await fetch(`${base}/esummary.fcgi?db=pubmed&id=${allIds.join(",")}&retmode=json`);
    const summaryData = await summaryRes.json();
    return (summaryData?.result?.uids || []).map(id => {
      const p = summaryData.result[id];
      if (!p) return null;
      const authors = (p.authors || []).slice(0, 3).map(a => a.name).join(", ");
      const year = p.pubdate?.slice(0, 4) || "";
      const journal = p.fulljournalname || p.source || "";
      const tag = relevantIds.includes(id) && recentIds.includes(id) ? "[Cité + Récent]"
        : relevantIds.includes(id) ? "[Très cité]" : "[Récent]";
      return `Titre: ${tag} ${p.title}\nURL: https://pubmed.ncbi.nlm.nih.gov/${id}/\nExtrait: ${authors}${year ? ` (${year})` : ""} — ${journal}`;
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
  return (await res.json()).access_token;
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
    const [fr, en] = await Promise.all([redditOAuthSearch(queryFr), redditOAuthSearch(queryEn)]);
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

JSON uniquement, sans texte avant/après:
{
  "books": "requête livres France sur ce sujet",
  "videos": "requête YouTube français sur ce sujet",
  "reddit_fr": "2-3 mots français pour Reddit",
  "reddit_en": "2-3 mots anglais pour Reddit",
  "instagram": "termes et hashtags Instagram français sur ce sujet",
  "facebook": "noms groupes ou termes Facebook francophones sur ce sujet",
  "linkedin_kol": "3-5 NOMS RÉELS de psychiatres ou psychologues FRANÇAIS reconnus sur ce sujet — uniquement PU-PH, chefs de service CHU, auteurs de recommandations HAS, présidents de sociétés savantes (SFPEADA, SPF, AFPDB, SFP). Format: 'Pr/Dr Prénom Nom spécialité' (ex: 'Pr Marie-France Moro psychiatrie transculturelle'). Ces personnes doivent être réellement connues.",
  "protocols": "requête EN ANGLAIS ET EN FRANÇAIS pour protocoles cliniques validés — cherche simultanément sur HAS (termes français officiels), NICE, Cochrane, APA, WHO. Utilise plusieurs synonymes séparés par OR (ex: 'trouble déficit attention hyperactivité OR TDAH OR ADHD clinical guideline protocol recommandation')",
  "pubmed_cited": "requête PubMed anglais termes MeSH pour études les plus citées (ex: 'ADHD[MeSH] meta-analysis')",
  "pubmed_recent": "requête PubMed anglais études récentes 2022-2025",
  "official": "requête française pour recommandations officielles sur ce sujet — utilise les termes nosologiques français officiels utilisés par la HAS",
  "forums": "termes précis pour forums médicaux professionnels français sur ce sujet",
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
      linkedin_kol: `professeur psychiatre psychologue ${t} france CHU`,
      protocols: `${t} OR ${t} clinical guideline protocole recommandation HAS NICE`,
      pubmed_cited: `${t} meta-analysis systematic review`,
      pubmed_recent: `${t} treatment 2023 2024`,
      official: `${t} recommandations HAS ANSM`,
      forums: `${t} forum psychologie psychiatrie france`,
      general: `${t} santé mentale france praticien`,
    };
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, agent clinique expert en santé mentale pour praticiens français.
LANGUE : Français uniquement.

RÈGLE ABSOLUE : Utilise UNIQUEMENT les URLs exactes des résultats fournis. Ne génère jamais d'URL.
Si section vide : "Rechercher manuellement : [terme exact]"

FORMAT — dans cet ordre, sections pertinentes uniquement :
### 📋 Protocoles & Guidelines
### 🔬 Articles les plus cités
### 🔬 Recherches récentes (2022-2025)
### 📄 Recommandations officielles
### 📚 Livres
### ▶️ Vidéos YouTube
### 🔗 LinkedIn — Key Opinion Leaders
### 📸 Instagram
### 👥 Facebook
### 💬 Reddit
### 💬 Forums professionnels

Pour LinkedIn KOL : indique titre (Pr./Dr.), institution (CHU/université), spécialité. Ne cite que des profils présents dans les résultats.
Pour Forums : max 5 résultats, uniquement forums médicaux/professionnels français, pas de réseaux sociaux.
Par ressource : **titre en gras**, 1 phrase description, URL sur ligne suivante. 3 lignes max par ressource.
Couvre TOUTES les sections disponibles. Outil d'aide décisionnelle uniquement.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;

  try {
    const q = await generateSearchQueries(lastMessage);

    // ── Max 8 Brave credits (7 if Reddit OAuth) ───────────────────
    // LinkedIn articles removed — saves 1 credit
    // Protocols uses broad multi-source query instead of HAS-specific
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

      // 1 — Protocols: broad search across ALL trusted clinical sources
      // No single HAS query — instead searches HAS + NICE + Cochrane + APA + WHO simultaneously
      // Uses both French AND English terms so nothing is missed
      braveSearch(
        `(${q.protocols}) (site:has-sante.fr OR site:ansm.sante.fr OR site:nice.org.uk OR site:cochranelibrary.com OR site:apa.org OR site:who.int OR site:nimh.nih.gov OR site:sfpeada.fr OR site:inserm.fr)`,
        6
      ),

      // 0 credits — PubMed direct API, cited + recent
      pubmedSearch(q.pubmed_cited, q.pubmed_recent),

      // 1 — Official guidelines: broad French nosological terms across HAS/ANSM/Inserm
      // Uses official French diagnostic terminology to match HAS document titles
      braveSearch(
        `${q.official} (site:has-sante.fr OR site:ansm.sante.fr OR site:inserm.fr OR site:who.int)`,
        5
      ),

      // 1 — Books
      braveSearch(`${q.books} site:amazon.fr OR site:fnac.com OR site:decitre.fr OR site:leslibraires.fr`),

      // 1 video credit
      braveVideoSearch(q.videos),

      // 0 (OAuth) or 1 (Brave fallback)
      redditSearch(q.reddit_fr, q.reddit_en),

      // 1 — Instagram
      braveSearch(`instagram.com ${q.instagram}`, 4),

      // 1 — Facebook
      braveSearch(`site:facebook.com groups ${q.facebook}`, 4),

      // 1 — LinkedIn KOLs: search named experts, not generic site: search
      // Searching name + specialty finds their actual indexed public profiles
      braveSearch(
        `(${q.linkedin_kol}) "linkedin.com" (psychiatre OR psychologue OR "PU-PH" OR "chef de service" OR "professeur")`,
        5
      ),

      // 1 — French professional forums only, max 5, no social media
      braveSearch(
        `${q.forums} (site:doctissimo.fr OR site:psychologies.com OR site:psycom.org OR site:forum-psychiatrie.fr OR site:soignants.com OR site:infirmiers.com OR site:jim.fr OR "forum" psychiatrie psychologie france) -site:reddit.com -site:facebook.com -site:instagram.com -site:linkedin.com`,
        5
      ),

      // 1 — General
      braveSearch(q.general, 4),
    ]);

    const sections = [
      protocols  && `[PROTOCOLES & GUIDELINES — HAS / NICE / Cochrane / APA / WHO]\n${protocols}`,
      pubmed     && `[PUBMED — Articles cités & Recherches récentes]\n${pubmed}`,
      official   && `[RECOMMANDATIONS OFFICIELLES — HAS / ANSM / Inserm]\n${official}`,
      books      && `[LIVRES]\n${books}`,
      videos     && `[VIDÉOS YOUTUBE]\n${videos}`,
      linkedin   && `[LINKEDIN — Key Opinion Leaders]\n${linkedin}`,
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

RAPPEL : URLs exactes uniquement. Respecte l'ordre. Max 5 pour Forums. 3 lignes max par ressource. Couvre tout.`,
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
