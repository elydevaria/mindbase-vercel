export const config = { maxDuration: 45 };

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";

// General Tavily search
async function tavilySearch(query, domains = []) {
  try {
    const body = {
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "advanced",
      max_results: 5,
      exclude_domains: ["pinterest.com", "slideshare.net", "scribd.com"],
    };
    if (domains.length) body.include_domains = domains;
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return (data.results || [])
      .filter(r => r.url && r.title)
      .map(r => `Titre: ${r.title}\nURL: ${r.url}\nExtrait: ${r.content?.slice(0, 200) || ""}`)
      .join("\n---\n");
  } catch (e) { return ""; }
}

// Reddit via official API — no auth needed for public search
async function redditSearch(query) {
  try {
    const res = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=5&type=sr,link&sort=relevance`,
      { headers: { "User-Agent": "MindBase/1.0" } }
    );
    const data = await res.json();
    const results = [];

    // Subreddits
    const subs = data[0]?.data?.children || [];
    subs.slice(0, 3).forEach(s => {
      const d = s.data;
      if (d.display_name && d.subscribers > 100) {
        results.push(`Titre: r/${d.display_name} — ${d.title || ""} (${d.subscribers?.toLocaleString()} membres)\nURL: https://www.reddit.com/r/${d.display_name}\nExtrait: ${d.public_description?.slice(0, 150) || ""}`);
      }
    });

    // Posts
    const posts = data[1]?.data?.children || [];
    posts.slice(0, 3).forEach(p => {
      const d = p.data;
      if (d.title && d.url) {
        results.push(`Titre: ${d.title}\nURL: https://www.reddit.com${d.permalink}\nExtrait: ${d.selftext?.slice(0, 150) || `Post in r/${d.subreddit}`}`);
      }
    });

    return results.join("\n---\n");
  } catch (e) { return ""; }
}

// LinkedIn via Google (site: search indexed public profiles/posts)
async function linkedinSearch(query) {
  return tavilySearch(`site:linkedin.com ${query} France santé mentale`, []);
}

// Instagram via Google (public posts indexed by Google)
async function instagramSearch(query) {
  return tavilySearch(`site:instagram.com ${query} praticien France`, []);
}

// Generate smart search queries adapted to the user's question
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
          content: `Tu es un expert en recherche web pour des praticiens de santé mentale français.

Pour cette question : "${userMessage}"

Génère des requêtes de recherche optimisées en JSON. Utilise les termes médicaux français corrects (TDAH pas ADHD, trouble anxieux généralisé pas GAD, etc.) et adapte chaque requête à sa plateforme cible.

Réponds UNIQUEMENT avec ce JSON :
{
  "books": "requête optimisée pour trouver des livres sur ce sujet en France",
  "youtube": "requête optimisée pour trouver des vidéos YouTube francophones sur ce sujet",
  "reddit": "requête courte pour Reddit — terme médical français + mots clés forum (ex: TDAH adulte aide)",
  "official": "requête pour recommandations officielles HAS ANSM sur ce sujet",
  "research": "requête pour recherches scientifiques PubMed Inserm sur ce sujet",
  "general": "requête générale large sur ce sujet pour praticiens français"
}`
        }]
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return {
      books: `${userMessage} livre amazon.fr fnac`,
      youtube: `${userMessage} youtube français praticien`,
      reddit: `${userMessage} france forum`,
      official: `${userMessage} has-sante.fr recommandations`,
      research: `${userMessage} pubmed inserm`,
      general: `${userMessage} santé mentale France praticien`,
    };
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, un agent clinique expert en santé mentale dédié aux praticiens français.
LANGUE : Réponds TOUJOURS en français.

RÈGLE ABSOLUE SUR LES LIENS :
- Utilise UNIQUEMENT les URLs exactes présentes dans les résultats de recherche fournis
- Copie les URLs mot pour mot — ne les modifie JAMAIS
- Si une URL n'est pas dans les résultats, écris "Rechercher : [terme exact sur la plateforme]"

NOTE SUR LINKEDIN ET INSTAGRAM : Ces plateformes bloquent les robots d'indexation.
Si aucun résultat LinkedIn ou Instagram n'est trouvé, indique les meilleures recherches à faire manuellement :
- LinkedIn : "Rechercher sur LinkedIn : [terme] psychologue France"
- Instagram : "Rechercher sur Instagram : #[terme] #psychologie #france"

FORMAT — utilise uniquement les sections pertinentes :
### 📚 Livres
### ▶️ Vidéos YouTube
### 📸 Instagram & Facebook
### 💬 Reddit & Forums
### 🔬 Recherches récentes
### 📄 Recommandations officielles
### 📋 Protocoles

Pour chaque ressource : titre en gras, description courte, URL exacte.
Tu es un outil d'aide décisionnelle uniquement.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;

  try {
    // Step 1 — generate smart queries
    const queries = await generateSearchQueries(lastMessage);

    // Step 2 — run all searches in parallel, each using the best method per platform
    const [books, youtube, reddit, official, research, general, linkedin, instagram] = await Promise.all([
      tavilySearch(queries.books, ["amazon.fr", "fnac.com", "decitre.fr", "cultura.com"]),
      tavilySearch(queries.youtube, ["youtube.com"]),
      redditSearch(queries.reddit),
      tavilySearch(queries.official, ["has-sante.fr", "ansm.sante.fr", "who.int", "ema.europa.eu"]),
      tavilySearch(queries.research, ["pubmed.ncbi.nlm.nih.gov", "inserm.fr", "psyarxiv.com"]),
      tavilySearch(queries.general),
      linkedinSearch(queries.general),
      instagramSearch(queries.general),
    ]);

    const searchContext = [
      books && `[LIVRES]\n${books}`,
      youtube && `[YOUTUBE]\n${youtube}`,
      reddit && `[REDDIT]\n${reddit}`,
      official && `[RECOMMANDATIONS OFFICIELLES]\n${official}`,
      research && `[RECHERCHES SCIENTIFIQUES]\n${research}`,
      general && `[GÉNÉRAL]\n${general}`,
      linkedin && `[LINKEDIN]\n${linkedin}`,
      instagram && `[INSTAGRAM]\n${instagram}`,
    ].filter(Boolean).join("\n\n===\n\n");

    const augmentedMessages = [
      ...messages.slice(0, -1),
      {
        role: "user",
        content: `${lastMessage}

=== RÉSULTATS DE RECHERCHE WEB EN TEMPS RÉEL ===
${searchContext || "Aucun résultat trouvé"}
=== FIN DES RÉSULTATS ===

RAPPEL : Utilise UNIQUEMENT les URLs ci-dessus. N'en invente aucune.`,
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
        max_tokens: 2000,
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
