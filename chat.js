export const config = { maxDuration: 30 };

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";

const SYSTEM_PROMPT = `Tu es MindBase, un agent clinique expert en santé mentale dédié aux praticiens français (psychiatres, psychologues, psychothérapeutes).

LANGUE : Réponds TOUJOURS en français.

TON RÔLE : Aider les cliniciens à trouver des informations pratiques et sourcées sur :
- Protocoles de traitement (TCC, DBT, EMDR, ACT, MBCT, thérapies psychodynamiques...)
- Livres disponibles en France — titres exacts, auteurs, liens Amazon.fr / Fnac
- Vidéos YouTube francophones pour cliniciens
- Recherches récentes — PubMed, PsyArXiv, Inserm — avec DOI et indication accès libre/payant
- Recommandations officielles — HAS, ANSM, OMS, EMA
- Communautés — Instagram, Facebook, Reddit, LinkedIn, X/Twitter

SOURCES PRIORITAIRES : HAS → ANSM → Inserm → OMS/EMA → PubMed/PsyArXiv → Amazon.fr/Fnac → YouTube → Instagram → Facebook → Reddit/LinkedIn

FORMAT CRITIQUE — Pour les questions sur les ressources, structure TOUJOURS avec ces sections pertinentes :
### 📚 Livres
### ▶️ Vidéos YouTube
### 📸 Instagram
### 👥 Facebook
### 💬 Reddit & Forums
### 🔬 Recherches récentes
### 📄 Recommandations officielles
### 📋 Protocoles

N'inclus que les sections pertinentes à la question.
Si tu ne connais pas un lien exact, indique "Rechercher : [terme exact]" plutôt qu'inventer.
Tu es un outil d'aide décisionnelle uniquement, jamais un substitut au jugement clinique.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "No messages" });

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
          ...messages.slice(-14),
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
