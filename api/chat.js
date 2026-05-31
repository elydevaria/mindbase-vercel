export const config = { maxDuration: 60 };

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";
const BRAVE_KEY = process.env.BRAVE_API_KEY;

// Brave Web Search
async function braveSearch(query, count = 5) {
  try {
    const params = new URLSearchParams({
      q: query,
      count: count.toString(),
      country: "fr",
      search_lang: "fr",
      ui_lang: "fr-FR",
      safesearch: "moderate",
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

    // Web results
    (data.web?.results || []).slice(0, count).forEach(r => {
      results.push(`Titre: ${r.title}\nURL: ${r.url}\nExtrait: ${r.description?.slice(0, 200) || ""}`);
    });

    // News results if available
    (data.news?.results || []).slice(0, 2).forEach(r => {
      results.push(`Titre: [ACTUALITÉ] ${r.title}\nURL: ${r.url}\nExtrait: ${r.description?.slice(0, 150) || ""}`);
    });

    return results.join("\n---\n");
  } catch (e) { return ""; }
}

// Brave Video Search (YouTube etc.)
async function braveVideoSearch(query, count = 5) {
  try {
    const params = new URLSearchParams({
      q: query,
      count: count.toString(),
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
      .map(r => `Titre: ${r.title}\nURL: ${r.url}\nExtrait: ${r.description?.slice(0, 150) || ""} (${r.age || ""})`)
      .join("\n---\n");
  } catch (e) { return ""; }
}

// Reddit via public API
async function redditSearch(query) {
  try {
    const encoded = encodeURIComponent(query);
    const [srRes, postRes] = await Promise.all([
      fetch(`https://www.reddit.com/search.json?q=${encoded}&type=sr&limit=5&sort=relevance`, {
        headers: { "User-Agent": "MindBase/1.0" }
      }),
      fetch(`https://www.reddit.com/search.json?q=${encoded}&type=link&limit=5&sort=relevance`, {
        headers: { "User-Agent": "MindBase/1.0" }
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

// Generate smart search queries
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
        max_tokens: 500,
        temperature: 0.1,
        messages: [{
          role: "user",
          content: `Tu es expert en recherche web pour des praticiens de santé mentale français.

Question : "${userMessage}"

Génère des requêtes optimisées. Utilise les termes médicaux français (TDAH, dépression, anxiété, TSPT, TCA, TOC, etc.)

Réponds UNIQUEMENT avec ce JSON exact :
{
  "books": "requête pour livres sur ce sujet en France",
  "videos": "requête courte pour vidéos YouTube français sur ce sujet",
  "reddit_fr": "terme médical français court pour Reddit (2-3 mots)",
  "reddit_en": "terme médical anglais court pour Reddit (2-3 mots)",
  "facebook": "requête pour groupes Facebook francophones sur ce sujet",
  "official": "requête pour recommandations HAS ANSM sur ce sujet",
  "pubmed": "requête médicale anglaise pour PubMed",
  "inserm": "requête pour Inserm sur ce sujet",
  "general": "requête générale sur ce sujet pour praticiens français"
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
      videos: `${t} youtube français praticien`,
      reddit_fr: t,
      reddit_en: t,
      facebook: `${t} groupe facebook france`,
      official: `${t} recommandations HAS ANSM`,
      pubmed: `${t} treatment psychiatry`,
      inserm: `${t} inserm`,
      general: `${t} santé mentale France`,
    };
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, un agent clinique expert en santé mentale dédié aux praticiens français.
LANGUE : Réponds TOUJOURS en français.

RÈGLES ABSOLUES :
- Utilise UNIQUEMENT les URLs exactes des résultats de recherche fournis
- Copie les URLs mot pour mot — ne les modifie JAMAIS
- Ne génère JAMAIS une URL de toi-même
- Si aucun résultat pour une section : "Aucun résultat — Rechercher : [terme suggéré]"

FORMAT — inclus toutes les sections qui ont des résultats :
### 📚 Livres
### ▶️ Vidéos YouTube
### 📸 Instagram & Facebook
### 💬 Reddit & Forums
### 🔬 Recherches récentes
### 📄 Recommandations officielles
### 📋 Protocoles (si pertinent)

Pour chaque ressource : **titre en gras**, une phrase de description, URL sur la ligne suivante.
Ne coupe JAMAIS ta réponse — couvre toutes les sections, résume si nécessaire mais termine.
Tu es un outil d'aide décisionnelle uniquement.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;

  try {
    const q = await generateSearchQueries(lastMessage);

    const [
      books, videos,
      reddit_fr, reddit_en,
      facebook, official,
      pubmed, inserm, general,
    ] = await Promise.all([
      braveSearch(`${q.books} site:amazon.fr OR site:fnac.com OR site:decitre.fr OR site:leslibraires.fr`),
      braveVideoSearch(q.videos),
      redditSearch(q.reddit_fr),
      redditSearch(q.reddit_en),
      braveSearch(`${q.facebook} site:facebook.com`),
      braveSearch(`${q.official} site:has-sante.fr OR site:ansm.sante.fr OR site:who.int`),
      braveSearch(`${q.pubmed} site:pubmed.ncbi.nlm.nih.gov`),
      braveSearch(`${q.inserm} site:inserm.fr OR site:psyarxiv.com OR site:hal.science`),
      braveSearch(q.general),
    ]);

    // Merge + deduplicate Reddit
    const redditUrls = new Set();
    const redditMerged = [
      ...(reddit_fr ? reddit_fr.split("\n---\n") : []),
      ...(reddit_en ? reddit_en.split("\n---\n") : []),
    ].filter(r => {
      const m = r.match(/URL: (https?:\/\/\S+)/);
      if (!m || redditUrls.has(m[1])) return false;
      redditUrls.add(m[1]);
      return true;
    }).join("\n---\n");

    const sections = [
      books        && `[LIVRES — Amazon.fr / Fnac / Decitre]\n${books}`,
      videos       && `[VIDÉOS YOUTUBE]\n${videos}`,
      redditMerged && `[REDDIT]\n${redditMerged}`,
      facebook     && `[FACEBOOK]\n${facebook}`,
      official     && `[RECOMMANDATIONS OFFICIELLES]\n${official}`,
      pubmed       && `[PUBMED]\n${pubmed}`,
      inserm       && `[INSERM / PSYARXIV]\n${inserm}`,
      general      && `[GÉNÉRAL]\n${general}`,
    ].filter(Boolean);

    const searchContext = sections.join("\n\n===\n\n");

    const augmentedMessages = [
      ...messages.slice(0, -1),
      {
        role: "user",
        content: `${lastMessage}

=== RÉSULTATS DE RECHERCHE (${sections.length} sources) ===
${searchContext || "Aucun résultat trouvé."}
=== FIN DES RÉSULTATS ===

RAPPEL : URLs exactes uniquement. Couvre toutes les sections. Ne coupe pas la réponse.`,
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
