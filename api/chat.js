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
      results.push(`Titre: ${r.title}\nURL: ${r.url}\nExtrait: ${r.description?.slice(0, 150) || ""}`);
    });
    return results.join("\n---\n");
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

// ─── Reddit OAuth2 if credentials exist, else Brave fallback ──────
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
    // OAuth — 0 Brave credits used
    const [fr, en] = await Promise.all([
      redditOAuthSearch(queryFr),
      redditOAuthSearch(queryEn),
    ]);
    const seen = new Set();
    return [...(fr ? fr.split("\n---\n") : []), ...(en ? en.split("\n---\n") : [])]
      .filter(r => { const m = r.match(/URL: (\S+)/); if (!m || seen.has(m[1])) return false; seen.add(m[1]); return true; })
      .join("\n---\n");
  } else {
    // Brave fallback — counts as 1 credit (combined query)
    return braveSearch(`site:reddit.com (${queryFr} OR ${queryEn})`, 5);
  }
}

// ─── Detect query intent to skip irrelevant searches ─────────────
function detectIntent(message) {
  const m = message.toLowerCase();
  return {
    wantsBooks:     /livre|book|lire|manuel|fnac|amazon|acheter/.test(m),
    wantsVideos:    /vid[eé]o|youtube|regarder|formation|cours/.test(m),
    wantsSocial:    /reddit|instagram|facebook|linkedin|forum|communaut[eé]|r[eé]seau/.test(m),
    wantsResearch:  /recherche|[eé]tude|pubmed|article|publication|inserm|preuve/.test(m),
    wantsGuideline: /recommandation|has|ansm|guideline|protocole|officiel/.test(m),
    wantsGeneral:   true, // always run general
  };
}

// ─── Generate smart queries (1 Mistral call) ──────────────────────
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
        max_tokens: 400,
        temperature: 0.1,
        messages: [{
          role: "user",
          content: `Expert en recherche web santé mentale française. Question : "${userMessage}"

Réponds UNIQUEMENT avec ce JSON (sans texte avant/après) :
{
  "books": "requête livres France sur ce sujet",
  "videos": "requête YouTube français sur ce sujet",
  "reddit_fr": "2-3 mots français pour Reddit",
  "reddit_en": "2-3 mots anglais pour Reddit",
  "social": "requête forums Instagram Facebook LinkedIn sur ce sujet France praticiens",
  "official": "requête HAS ANSM OMS sur ce sujet",
  "research": "requête PubMed Inserm anglais sur ce sujet",
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
      reddit_fr: t,
      reddit_en: t,
      social: `${t} forum instagram facebook france praticien`,
      official: `${t} HAS ANSM recommandations`,
      research: `${t} treatment pubmed inserm`,
      general: `${t} santé mentale france`,
    };
  }
}

// ─── System prompt ────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es MindBase, agent clinique expert en santé mentale pour praticiens français.
LANGUE : Français uniquement.

RÈGLES LIENS : URLs exactes des résultats uniquement. Ne génère jamais d'URL toi-même.
Si section vide : "Rechercher manuellement : [terme exact]"

FORMAT — sections pertinentes uniquement :
### 📚 Livres
### ▶️ Vidéos YouTube
### 📸 Instagram & Facebook
### 💬 Reddit & Forums
### 🔬 Recherches récentes
### 📄 Recommandations officielles
### 📋 Protocoles

Par ressource : **titre**, description courte (1 phrase), URL.
Sois concis par ressource — 2-3 lignes max chacune.
Couvre toutes les sections disponibles sans exception.
Outil d'aide décisionnelle uniquement.`;

// ─── Main handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;
  const intent = detectIntent(lastMessage);

  try {
    const q = await generateSearchQueries(lastMessage);

    // ── Smart search — only run what's needed ──────────────────
    // Max 5 Brave API calls per request (down from 9)
    // Reddit uses its own API when credentials exist (0 Brave credits)
    const searchPromises = {
      // Always run: general + official + research (3 calls)
      general:  braveSearch(q.general),
      official: braveSearch(`${q.official} site:has-sante.fr OR site:ansm.sante.fr OR site:who.int OR site:pubmed.ncbi.nlm.nih.gov OR site:inserm.fr`),
      research: braveSearch(`${q.research} site:pubmed.ncbi.nlm.nih.gov OR site:inserm.fr OR site:psyarxiv.com`),
      // Conditional: books (1 call) — skip if clearly not a book query
      ...(intent.wantsBooks || !intent.wantsVideos && !intent.wantsSocial
        ? { books: braveSearch(`${q.books} site:amazon.fr OR site:fnac.com OR site:decitre.fr OR site:leslibraires.fr`) }
        : {}),
      // Conditional: videos (1 video API call) — skip if clearly not a video query  
      ...(intent.wantsVideos || !intent.wantsBooks && !intent.wantsSocial
        ? { videos: braveVideoSearch(q.videos) }
        : {}),
      // Social: combined into 1 Brave call (Instagram + Facebook + LinkedIn + forums)
      social: braveSearch(`(${q.social}) (site:instagram.com OR site:facebook.com OR site:linkedin.com OR forum OR discussion)`, 6),
      // Reddit: uses own API if credentials exist (free), else 1 Brave call
      reddit: redditSearch(q.reddit_fr, q.reddit_en),
    };

    const keys = Object.keys(searchPromises);
    const values = await Promise.all(Object.values(searchPromises));
    const results = Object.fromEntries(keys.map((k, i) => [k, values[i]]));

    // ── Build context ──────────────────────────────────────────
    const sections = [
      results.books   && `[LIVRES]\n${results.books}`,
      results.videos  && `[VIDÉOS YOUTUBE]\n${results.videos}`,
      results.reddit  && `[REDDIT]\n${results.reddit}`,
      results.social  && `[INSTAGRAM / FACEBOOK / LINKEDIN / FORUMS]\n${results.social}`,
      results.official && `[RECOMMANDATIONS OFFICIELLES + RECHERCHES]\n${results.official}`,
      results.research && `[PUBMED / INSERM]\n${results.research}`,
      results.general && `[GÉNÉRAL]\n${results.general}`,
    ].filter(Boolean);

    const augmentedMessages = [
      ...messages.slice(0, -1),
      {
        role: "user",
        content: `${lastMessage}

=== RÉSULTATS (${sections.length} sources) ===
${sections.join("\n\n===\n\n") || "Aucun résultat."}
=== FIN ===

Utilise UNIQUEMENT ces URLs. Couvre toutes les sections. Sois concis par ressource.`,
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
        max_tokens: 4000,  // increased from 3000 to prevent cutoffs
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
