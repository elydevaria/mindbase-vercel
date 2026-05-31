export const config = { maxDuration: 45 };

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";

async function search(query) {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "advanced",
        max_results: 5,
        include_domains: [],
        exclude_domains: ["pinterest.com", "slideshare.net", "scribd.com"],
      }),
    });
    const data = await res.json();
    return (data.results || [])
      .filter(r => r.url && r.title)
      .map(r => `Titre: ${r.title}\nURL: ${r.url}\nExtrait: ${r.content?.slice(0, 200) || ""}`)
      .join("\n---\n");
  } catch (e) {
    return "";
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, un agent clinique expert en santé mentale dédié aux praticiens français.
LANGUE : Réponds TOUJOURS en français.

RÈGLE ABSOLUE SUR LES LIENS :
- Utilise UNIQUEMENT les URLs exactes présentes dans les résultats de recherche fournis
- Copie les URLs mot pour mot — ne les modifie JAMAIS
- Si une URL n'est pas dans les résultats, écris "Rechercher : [terme exact]" — ne génère RIEN
- Vérifie que chaque URL que tu cites est bien dans les résultats avant de la mentionner

FORMAT — utilise uniquement les sections pertinentes :
### 📚 Livres
### ▶️ Vidéos YouTube
### 📸 Instagram & Facebook
### 💬 Reddit & Forums
### 🔬 Recherches récentes
### 📄 Recommandations officielles
### 📋 Protocoles

Pour chaque ressource : titre en gras, description courte, puis l'URL exacte des résultats.
Tu es un outil d'aide décisionnelle uniquement.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  const lastMessage = messages[messages.length - 1].content;

  // Detect what kind of query it is to target searches better
  const isBooks = /livre|book|manuel|ouvrage|lire|fnac|amazon/i.test(lastMessage);
  const isVideo = /vid[eé]o|youtube|regarder|formation/i.test(lastMessage);
  const isResearch = /recherche|[eé]tude|pubmed|article|publication|preuve/i.test(lastMessage);
  const isGuideline = /recommandation|has|ansm|guideline|protocole|officiel/i.test(lastMessage);
  const isSocial = /instagram|facebook|reddit|communaut[eé]|forum|linkedin/i.test(lastMessage);

  // Always run general + 2-3 targeted searches based on query type
  const searches = [
    search(`${lastMessage} France praticien psychologue psychiatre`),
  ];

  if (isBooks || !isVideo && !isResearch && !isGuideline && !isSocial) {
    searches.push(search(`${lastMessage} livre amazon.fr`));
    searches.push(search(`${lastMessage} livre fnac.com`));
  }
  if (isVideo || (!isBooks && !isResearch && !isGuideline && !isSocial)) {
    searches.push(search(`${lastMessage} youtube.com français`));
  }
  if (isResearch || (!isBooks && !isVideo && !isGuideline && !isSocial)) {
    searches.push(search(`${lastMessage} pubmed.ncbi.nlm.nih.gov`));
    searches.push(search(`${lastMessage} inserm.fr`));
  }
  if (isGuideline || (!isBooks && !isVideo && !isResearch && !isSocial)) {
    searches.push(search(`${lastMessage} has-sante.fr recommandations`));
    searches.push(search(`${lastMessage} ansm.sante.fr`));
  }
  if (isSocial || (!isBooks && !isVideo && !isResearch && !isGuideline)) {
    searches.push(search(`${lastMessage} reddit.com france`));
    searches.push(search(`${lastMessage} instagram facebook groupe france`));
  }

  const results = await Promise.all(searches);
  const searchContext = results.filter(Boolean).join("\n\n===\n\n");

  const augmentedMessages = [
    ...messages.slice(0, -1),
    {
      role: "user",
      content: `${lastMessage}

=== RÉSULTATS DE RECHERCHE WEB EN TEMPS RÉEL ===
${searchContext || "Aucun résultat trouvé"}
=== FIN DES RÉSULTATS ===

RAPPEL : Utilise UNIQUEMENT les URLs ci-dessus, copiées exactement. N'en invente aucune.`,
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
