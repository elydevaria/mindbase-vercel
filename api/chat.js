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

// ─── Reddit: OAuth if credentials exist, else Brave ───────────────
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
    // Brave fallback — 1 credit
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
        max_tokens: 400,
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
  "instagram": "hashtags et termes pour Instagram sur ce sujet en français (ex: #TDAH psychologie praticien)",
  "facebook": "nom de groupes Facebook ou termes pour ce sujet en France",
  "linkedin": "termes professionnels LinkedIn santé mentale France sur ce sujet",
  "forums": "termes pour forums médicaux professionnels français sur ce sujet",
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
      reddit_fr: t, reddit_en: t,
      instagram: `${t} instagram praticien`,
      facebook: `${t} groupe facebook france`,
      linkedin: `${t} linkedin psychologue france`,
      forums: `${t} forum professionnel france`,
      official: `${t} HAS ANSM`,
      research: `${t} treatment pubmed`,
      general: `${t} santé mentale france`,
    };
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, agent clinique expert en santé mentale pour praticiens français.
LANGUE : Français uniquement.

RÈGLE ABSOLUE : Utilise UNIQUEMENT les URLs exactes des résultats fournis. Ne génère jamais d'URL toi-même.
Si section vide : "Rechercher manuellement : [terme exact sur cette plateforme]"

FORMAT — inclus toutes les sections qui ont des résultats :
### 📚 Livres
### ▶️ Vidéos YouTube
### 📸 Instagram
### 👥 Facebook & LinkedIn
### 💬 Reddit & Forums
### 🔬 Recherches récentes
### 📄 Recommandations officielles
### 📋 Protocoles (si pertinent)

Par ressource : **titre en gras**, 1 phrase description, URL sur ligne suivante.
Sois concis — 3 lignes max par ressource. Couvre TOUTES les sections disponibles.
Outil d'aide décisionnelle uniquement.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;

  try {
    const q = await generateSearchQueries(lastMessage);

    // ── 7 Brave calls max (Reddit free via OAuth when credentials set) ──
    // Grouped smartly to maximise result quality per credit:
    // 1. Books (bookstore domains only)
    // 2. Videos (video API — separate endpoint, same credit pool)
    // 3. Reddit (free via OAuth, or 1 Brave credit fallback)
    // 4. Instagram (site: search — Brave crawls public IG posts well)
    // 5. Facebook + LinkedIn + Forums (combined — similar professional content)
    // 6. Official guidelines + PubMed combined
    // 7. General broad search
    const [
      books, videos, reddit,
      instagram, socialForums,
      officialResearch, general,
    ] = await Promise.all([
      // 1 credit — bookstores only
      braveSearch(`${q.books} site:amazon.fr OR site:fnac.com OR site:decitre.fr OR site:leslibraires.fr`),
      // 1 video credit — YouTube
      braveVideoSearch(q.videos),
      // 0 credits if OAuth, else 1 credit
      redditSearch(q.reddit_fr, q.reddit_en),
      // 1 credit — Instagram only, dedicated search
      // Key insight: use hashtag-style terms + "instagram.com" for better results
      braveSearch(`site:instagram.com ${q.instagram}`, 5),
      // 1 credit — Facebook + LinkedIn + professional forums combined
      // These return similar professional content so combining works well
      braveSearch(`(${q.facebook} site:facebook.com) OR (${q.linkedin} site:linkedin.com) OR (${q.forums} forum professionnel psychologie)`, 6),
      // 1 credit — official sources + research combined
      braveSearch(`(${q.official} site:has-sante.fr OR site:ansm.sante.fr OR site:who.int) OR (${q.research} site:pubmed.ncbi.nlm.nih.gov OR site:inserm.fr OR site:psyarxiv.com)`, 6),
      // 1 credit — general
      braveSearch(q.general, 5),
    ]);

    // Split socialForums results by domain for cleaner display
    const socialItems = socialForums ? socialForums.split("\n---\n") : [];
    const facebookItems = socialItems.filter(r => r.includes("facebook.com")).join("\n---\n");
    const linkedinItems = socialItems.filter(r => r.includes("linkedin.com")).join("\n---\n");
    const forumItems = socialItems.filter(r => !r.includes("facebook.com") && !r.includes("linkedin.com")).join("\n---\n");

    const fbLinkedinForums = [facebookItems, linkedinItems, forumItems].filter(Boolean).join("\n---\n");

    const sections = [
      books              && `[LIVRES]\n${books}`,
      videos             && `[VIDÉOS YOUTUBE]\n${videos}`,
      reddit             && `[REDDIT]\n${reddit}`,
      instagram          && `[INSTAGRAM]\n${instagram}`,
      fbLinkedinForums   && `[FACEBOOK / LINKEDIN / FORUMS]\n${fbLinkedinForums}`,
      officialResearch   && `[RECOMMANDATIONS OFFICIELLES & RECHERCHES]\n${officialResearch}`,
      general            && `[GÉNÉRAL]\n${general}`,
    ].filter(Boolean);

    const augmentedMessages = [
      ...messages.slice(0, -1),
      {
        role: "user",
        content: `${lastMessage}

=== RÉSULTATS (${sections.length} sources) ===
${sections.join("\n\n===\n\n") || "Aucun résultat."}
=== FIN ===

RAPPEL : URLs exactes uniquement. Couvre toutes les sections. 3 lignes max par ressource.`,
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
