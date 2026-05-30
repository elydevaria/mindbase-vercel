export const config = { maxDuration: 30 };

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";

async function webSearch(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url);
    const data = await res.json();
    const results = [];
    if (data.AbstractText) results.push(`${data.AbstractText} (${data.AbstractURL})`);
    if (data.RelatedTopics) {
      data.RelatedTopics.slice(0, 5).forEach(t => {
        if (t.Text && t.FirstURL) results.push(`${t.Text} - ${t.FirstURL}`);
      });
    }
    return results.join("\n");
  } catch (e) {
    return "";
  }
}

async function searchGoogle(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query + " site:amazon.fr OR site:fnac.com OR site:has-sante.fr OR site:youtube.com OR site:pubmed.ncbi.nlm.nih.gov")}&format=json&no_html=1`;
    const res = await fetch(url);
    const data = await res.json();
    const results = [];
    if (data.Results) data.Results.slice(0, 6).forEach(r => results.push(`${r.Text} - ${r.FirstURL}`));
    if (data.RelatedTopics) data.RelatedTopics.slice(0, 5).forEach(t => { if (t.Text && t.FirstURL) results.push(`${t.Text} - ${t.FirstURL}`); });
    return results.join("\n");
  } catch (e) {
    return "";
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, un agent clinique expert en santé mentale dédié aux praticiens français.
LANGUE : Réponds TOUJOURS en français.
Tu recevras des résultats de recherche web réels dans chaque message — utilise-les pour fournir des liens réels et vérifiés.
Ne fournis JAMAIS un lien que tu n'as pas vu dans les résultats de recherche fournis.
Si un lien n'est pas dans les résultats, dis "Rechercher : [terme exact sur amazon.fr / fnac.com / etc.]"

FORMAT — structure avec ces sections pertinentes :
### 📚 Livres
### ▶️ Vidéos YouTube
### 📸 Instagram
### 👥 Facebook
### 💬 Reddit & Forums
### 🔬 Recherches récentes
### 📄 Recommandations officielles
### 📋 Protocoles

Tu es un outil d'aide décisionnelle uniquement.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;

  // Search for real results
  const [general, specific] = await Promise.all([
    webSearch(lastMessage + " France santé mentale"),
    searchGoogle(lastMessage + " France praticien"),
  ]);

  const searchContext = [general, specific].filter(Boolean).join("\n");

  const augmentedMessages = [
    ...messages.slice(0, -1),
    {
      role: "user",
      content: lastMessage + (searchContext ? `\n\n[RÉSULTATS DE RECHERCHE WEB RÉELS — utilise ces liens dans ta réponse]\n${searchContext}` : ""),
    },
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
