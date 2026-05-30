export const config = { maxDuration: 30 };

const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

const SYSTEM_PROMPT = `Tu es MindBase, un agent clinique expert en santé mentale dédié aux praticiens français.
LANGUE : Réponds TOUJOURS en français.
TON RÔLE : Aider les cliniciens à trouver des informations pratiques et sourcées sur :
- Protocoles de traitement (TCC, DBT, EMDR, ACT, MBCT...)
- Livres disponibles en France avec liens Amazon.fr / Fnac
- Vidéos YouTube francophones pour cliniciens avec liens directs
- Recherches récentes PubMed, PsyArXiv, Inserm avec DOI
- Recommandations officielles HAS, ANSM, OMS avec liens directs
- Communautés Instagram, Facebook, Reddit, LinkedIn, X/Twitter
SOURCES : HAS → ANSM → Inserm → OMS/EMA → PubMed → Amazon.fr/Fnac → YouTube → Réseaux sociaux
FORMAT — structure toujours avec sections pertinentes :
### 📚 Livres
### ▶️ Vidéos YouTube  
### 📸 Instagram
### 👥 Facebook
### 💬 Reddit & Forums
### 🔬 Recherches récentes
### 📄 Recommandations officielles
### 📋 Protocoles
Fournis uniquement des liens vérifiés et existants. Tu es un outil d'aide décisionnelle uniquement.`;

async function getOrCreateAgent() {
  // List existing agents to find ours
  const listRes = await fetch("https://api.mistral.ai/v1/agents?limit=50", {
    headers: { "Authorization": `Bearer ${MISTRAL_KEY}` },
  });
  const listData = await listRes.json();
  const existing = listData.data?.find(a => a.name === "MindBase-WebSearch");
  if (existing) return existing.id;

  // Create agent with web search if not found
  const createRes = await fetch("https://api.mistral.ai/v1/agents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${MISTRAL_KEY}`,
    },
    body: JSON.stringify({
      model: "mistral-small-latest",
      name: "MindBase-WebSearch",
      instructions: SYSTEM_PROMPT,
      tools: [{ type: "web_search" }],
      completion_args: { temperature: 0.3, max_tokens: 2000 },
    }),
  });
  const agent = await createRes.json();
  return agent.id;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

  try {
    const agentId = await getOrCreateAgent();

    // Use Agents conversation API
    const response = await fetch("https://api.mistral.ai/v1/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_KEY}`,
      },
      body: JSON.stringify({
        agent_id: agentId,
        inputs: messages[messages.length - 1].content,
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    // Extract text from response
    const reply = data.outputs?.find(o => o.type === "message")?.content
      || data.choices?.[0]?.message?.content
      || "Aucun résultat.";

    res.json({ reply });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
