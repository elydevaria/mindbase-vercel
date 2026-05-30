export const config = { maxDuration: 30 };

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";

async function tavilySearch(query) {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: 6,
        include_answer: false,
      }),
    });
    const data = await res.json();
    return (data.results || [])
      .map(r => `- ${r.title}\n  URL: ${r.url}\n  ${r.content?.slice(0, 150) || ""}`)
      .join("\n\n");
  } catch (e) {
    return "";
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, un agent clinique expert en santé mentale dédié aux praticiens français.
LANGUE : Réponds TOUJOURS en français.

RÈGLE ABSOLUE : Tu recevras des résultats de recherche web réels. Utilise UNIQUEMENT les URLs présentes dans ces résultats. Ne génère JAMAIS une URL toi-même. Si tu ne trouves pas de lien réel, écris "Rechercher sur [site] : [terme exact]".

FORMAT — utilise les sections pertinentes :
### 📚 Livres
### ▶️ Vidéos YouTube
### 📸 Instagram
### 👥 Facebook
### 💬 Reddit & Forums
### 🔬 Recherches récentes
### 📄 Recommandations officielles
### 📋 Protocoles

Tu es un outil d'aide décisionnelle uniquement, jamais un substitut au jugement clinique.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;

  // 3 targeted searches in parallel
  const [general, books, official] = await Promise.all([
    tavilySearch(`${lastMessage} santé mentale France praticien`),
    tavilySearch(`${lastMessage} livre amazon.fr fnac youtube`),
    tavilySearch(`${lastMessage} has-sante.fr ansm.sante.fr pubmed`),
  ]);

  const searchResults = `=== RÉSULTATS DE RECHERCHE WEB RÉELS ===

[Général]
${general || "Aucun résultat"}

[Livres & Vidéos]
${books || "Aucun résultat"}

[Sources officielles]
${official || "Aucun résultat"}

=== UTILISE UNIQUEMENT CES URLs — N'EN INVENTE AUCUNE ===`;

  const augmentedMessages = [
    ...messages.slice(0, -1),
    { role: "user", content: `${lastMessage}\n\n${searchResults}` },
  ];

  try {
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
        temperature: 0.3,
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
