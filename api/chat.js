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
    (data.news?.results || []).slice(0, 2).forEach(r => {
      results.push(`Titre: [ACTUALITÉ] ${r.title}\nURL: ${r.url}\nExtrait: ${r.description?.slice(0, 150) || ""}`);
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

// ─── Reddit OAuth2 ────────────────────────────────────────────────
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
      fetch(`https://oauth.reddit.com/search?q=${encoded}&type=sr&limit=5&sort=relevance`, {
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": REDDIT_USER_AGENT },
      }),
      fetch(`https://oauth.reddit.com/search?q=${encoded}&type=link&limit=5&sort=relevance`, {
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": REDDIT_USER_AGENT },
      }),
    ]);
    const results = [];
    if (srRes.ok) {
      const srData = await srRes.json();
      (srData?.data?.children || []).slice(0, 3).forEach(s => {
        const d = s.data;
        if (d.display_name && (d.subscribers || 0) > 50) {
          results.push(`Titre: r/${d.display_name} — ${d.title || d.display_name} (${(d.subscribers||0).toLocaleString()} membres)\nURL: https://www.reddit.com/r/${d.display_name}\nExtrait: ${d.public_description?.slice(0, 150) || "Communauté Reddit"}`);
        }
      });
    }
    if (postRes.ok) {
      const postData = await postRes.json();
      (postData?.data?.children || []).slice(0, 4).forEach(p => {
        const d = p.data;
        if (d.title && d.permalink) {
          results.push(`Titre: ${d.title} (r/${d.subreddit})\nURL: https://www.reddit.com${d.permalink}\nExtrait: ${d.selftext?.slice(0, 150) || `Discussion dans r/${d.subreddit}`}`);
        }
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
      .filter(r => {
        const m = r.match(/URL: (https?:\/\/\S+)/);
        if (!m || seen.has(m[1])) return false;
        seen.add(m[1]);
        return true;
      }).join("\n---\n");
  } else {
    const [fr, en] = await Promise.all([
      braveSearch(`site:reddit.com ${queryFr}`, 5),
      braveSearch(`site:reddit.com ${queryEn}`, 5),
    ]);
    const seen = new Set();
    return [...(fr ? fr.split("\n---\n") : []), ...(en ? en.split("\n---\n") : [])]
      .filter(r => {
        const m = r.match(/URL: (https?:\/\/\S+)/);
        if (!m || seen.has(m[1])) return false;
        seen.add(m[1]);
        return true;
      }).join("\n---\n");
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
          content: `Tu es expert en recherche web pour des praticiens de santé mentale français.

Question : "${userMessage}"

Génère des requêtes optimisées. Utilise les termes médicaux français corrects.
Pour Reddit : termes courts et directs (2-3 mots max).
Pour PubMed : traduis en anglais médical.
Pour les forums : pense aux forums médicaux français (Doctissimo, Psychologies, forums professionnels de psychiatrie/psychologie), pas seulement Reddit.

Réponds UNIQUEMENT avec ce JSON exact, sans texte avant ni après :
{
  "books": "requête pour livres sur ce sujet disponibles en France",
  "videos": "requête courte pour vidéos YouTube français sur ce sujet",
  "reddit_fr": "terme médical français court pour Reddit",
  "reddit_en": "terme médical anglais court pour Reddit",
  "forums": "requête pour forums médicaux et discussions professionnelles françaises sur ce sujet (hors Reddit)",
  "instagram": "requête pour comptes Instagram francophones sur ce sujet",
  "facebook": "requête pour groupes Facebook francophones sur ce sujet",
  "linkedin": "requête pour professionnels LinkedIn santé mentale France sur ce sujet",
  "official": "requête pour recommandations HAS ANSM sur ce sujet",
  "pubmed": "requête médicale anglaise pour PubMed",
  "inserm": "requête pour Inserm sur ce sujet",
  "general": "requête générale large sur ce sujet pour praticiens français"
}`
        }]
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    const t = userMessage.slice(0, 40);
    return {
      books: `${t} livre amazon fnac france`,
      videos: `${t} youtube français`,
      reddit_fr: t,
      reddit_en: t,
      forums: `${t} forum discussion professionnel france`,
      instagram: `${t} instagram france praticien`,
      facebook: `${t} groupe facebook france`,
      linkedin: `${t} linkedin psychologue france`,
      official: `${t} recommandations HAS ANSM`,
      pubmed: `${t} treatment psychiatry`,
      inserm: `${t} inserm recherche`,
      general: `${t} santé mentale France praticien`,
    };
  }
}

// ─── System prompt ────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es MindBase, un agent clinique expert en santé mentale dédié aux praticiens français.
LANGUE : Réponds TOUJOURS en français.

RÈGLES ABSOLUES SUR LES LIENS :
- Utilise UNIQUEMENT les URLs exactes présentes dans les résultats de recherche fournis
- Copie les URLs mot pour mot — ne les modifie JAMAIS
- Ne génère JAMAIS une URL de toi-même
- Si une section n'a aucun résultat : "Aucun résultat — Rechercher manuellement : [terme exact]"

FORMAT — inclus toutes les sections qui ont des résultats :
### 📚 Livres
### ▶️ Vidéos YouTube
### 📸 Instagram
### 👥 Facebook & LinkedIn
### 💬 Reddit & Forums
### 🔬 Recherches récentes
### 📄 Recommandations officielles
### 📋 Protocoles (si pertinent)

Pour la section Reddit & Forums : inclus à la fois les communautés Reddit ET les forums médicaux/professionnels trouvés (Doctissimo, Psychologies, forums psychiatrie, etc.)
Pour chaque ressource : **titre en gras**, une phrase de description, URL sur la ligne suivante.
Ne coupe JAMAIS ta réponse — couvre toutes les sections, résume si nécessaire mais termine toujours.
Tu es un outil d'aide décisionnelle uniquement.`;

// ─── Main handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;

  try {
    const q = await generateSearchQueries(lastMessage);

    const [
      books, videos,
      reddit,
      forums,
      instagram, facebook, linkedin,
      official, pubmed, inserm, general,
    ] = await Promise.all([
      // Books
      braveSearch(`${q.books} site:amazon.fr OR site:fnac.com OR site:decitre.fr OR site:leslibraires.fr`),
      // Videos
      braveVideoSearch(q.videos),
      // Reddit
      redditSearch(q.reddit_fr, q.reddit_en),
      // Forums — medical/professional French forums beyond Reddit
      braveSearch(`${q.forums} (forum OR discussion OR communauté) -site:reddit.com`, 6),
      // Instagram
      braveSearch(`site:instagram.com ${q.instagram}`, 5),
      // Facebook
      braveSearch(`site:facebook.com ${q.facebook} groupe`, 5),
      // LinkedIn
      braveSearch(`site:linkedin.com ${q.linkedin}`, 4),
      // Official
      braveSearch(`${q.official} site:has-sante.fr OR site:ansm.sante.fr OR site:who.int`),
      // PubMed
      braveSearch(`${q.pubmed} site:pubmed.ncbi.nlm.nih.gov`),
      // Inserm
      braveSearch(`${q.inserm} site:inserm.fr OR site:psyarxiv.com OR site:hal.science`),
      // General
      braveSearch(q.general),
    ]);

    const sections = [
      books     && `[LIVRES]\n${books}`,
      videos    && `[VIDÉOS YOUTUBE]\n${videos}`,
      reddit    && `[REDDIT]\n${reddit}`,
      forums    && `[FORUMS MÉDICAUX & PROFESSIONNELS]\n${forums}`,
      instagram && `[INSTAGRAM]\n${instagram}`,
      facebook  && `[FACEBOOK]\n${facebook}`,
      linkedin  && `[LINKEDIN]\n${linkedin}`,
      official  && `[RECOMMANDATIONS OFFICIELLES]\n${official}`,
      pubmed    && `[PUBMED]\n${pubmed}`,
      inserm    && `[INSERM / PSYARXIV]\n${inserm}`,
      general   && `[GÉNÉRAL]\n${general}`,
    ].filter(Boolean);

    const augmentedMessages = [
      ...messages.slice(0, -1),
      {
        role: "user",
        content: `${lastMessage}

=== RÉSULTATS DE RECHERCHE WEB EN TEMPS RÉEL (${sections.length} sources) ===
${sections.join("\n\n===\n\n") || "Aucun résultat trouvé."}
=== FIN DES RÉSULTATS ===

RAPPEL : URLs exactes uniquement. Couvre toutes les sections. Ne coupe pas ta réponse.`,
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
        max_tokens: 3000,
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
