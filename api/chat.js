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

async function generateSearchQueries(userMessage) {
  // Ask Mistral to generate smart targeted search queries
  const res = await fetch(MISTRAL_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: "mistral-small-latest",
      max_tokens: 300,
      temperature: 0.1,
      messages: [{
        role: "user",
        content: `Tu es un expert en recherche web pour des praticiens de santé mentale français.
        
Pour cette question : "${userMessage}"

Génère exactement 6 requêtes de recherche optimisées en JSON. Adapte les termes médicaux français (ex: TDAH pas ADHD, dépression pas depression, etc.) et cible les bonnes plateformes.

Réponds UNIQUEMENT avec ce JSON, rien d'autre :
{
  "queries": [
    "requête pour livres Amazon.fr et Fnac",
    "requête pour vidéos YouTube francophones",
    "requête pour forums Reddit et communautés françaises",
    "requête pour recommandations officielles HAS ANSM",
    "requête pour recherches PubMed Inserm",
    "requête pour Instagram Facebook groupes professionnels"
  ]
}`
      }]
    }),
  });
  
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  
  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return parsed.queries || [];
  } catch (e) {
    // Fallback queries if parsing fails
    return [
      `${userMessage} livre amazon.fr fnac`,
      `${userMessage} youtube français praticien`,
      `${userMessage} reddit forum france`,
      `${userMessage} has-sante.fr recommandations`,
      `${userMessage} pubmed inserm recherche`,
      `${userMessage} instagram facebook groupe`,
    ];
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, un agent clinique expert en santé mentale dédié aux praticiens français.
LANGUE : Réponds TOUJOURS en français.

RÈGLE ABSOLUE SUR LES LIENS :
- Utilise UNIQUEMENT les URLs exactes présentes dans les résultats de recherche fournis
- Copie les URLs mot pour mot — ne les modifie JAMAIS
- Si une URL n'est pas dans les résultats, écris "Rechercher : [terme exact]" — ne génère RIEN

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

  try {
    // Step 1 — generate smart search queries based on user question
    const queries = await generateSearchQueries(lastMessage);

    // Step 2 — run all searches in parallel
    const results = await Promise.all(queries.map(q => search(q)));
    const searchContext = results.filter(Boolean).join("\n\n===\n\n");

    // Step 3 — ask Mistral to answer using real search results
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
