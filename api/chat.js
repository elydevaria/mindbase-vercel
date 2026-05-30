export const config = { maxDuration: 30 };

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";

async function ddgSearch(query) {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const html = await res.text();
    const results = [];
    const linkRegex = /class="result__url"[^>]*>([^<]+)<\/a>/g;
    const titleRegex = /class="result__a"[^>]*>([^<]+)<\/a>/g;
    const snippetRegex = /class="result__snippet"[^>]*>([^<]+)<\/a>/g;
    const titles = [...html.matchAll(/class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
    const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/span>/g)];
    titles.slice(0, 8).forEach((m, i) => {
      const url = m[1].startsWith("/") ? `https://duckduckgo.com${m[1]}` : m[1];
      const title = m[2].replace(/<[^>]+>/g, "").trim();
      const snippet = snippets[i] ? snippets[i][1].replace(/<[^>]+>/g, "").trim() : "";
      results.push(`- ${title}\n  URL: ${url}\n  ${snippet}`);
    });
    return results.join("\n\n");
  } catch (e) {
    return "";
  }
}

const SYSTEM_PROMPT = `Tu es MindBase, un agent clinique expert en santé mentale dédié aux praticiens français.
LANGUE : Réponds TOUJOURS en français.

RÈGLE ABSOLUE SUR LES LIENS :
- Tu recevras des résultats de recherche web réels dans chaque message
- Utilise UNIQUEMENT les URLs présentes dans ces résultats de recherche
- Ne génère JAMAIS une URL de toi-même
- Si tu ne trouves pas un lien dans les résultats, écris exactement : "Rechercher sur [site] : [terme]"

FORMAT — structure avec les sections pertinentes :
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

  // Run multiple targeted searches in parallel
  const [general, books, videos, official] = await Promise.all([
    ddgSearch(`${lastMessage} santé mentale France praticien`),
    ddgSearch(`${lastMessage} livre amazon.fr fnac`),
    ddgSearch(`${lastMessage} youtube.com vidéo`),
    ddgSearch(`${lastMessage} site:has-sante.fr OR site:ansm.sante.fr OR site:pubmed.ncbi.nlm.nih.gov`),
  ]);

  const searchResults = `
=== RÉSULTATS DE RECHERCHE RÉELS ===

[Recherche générale]
${general}

[Livres Amazon/Fnac]
${books}

[Vidéos YouTube]
${videos}

[Sources officielles HAS/ANSM/PubMed]
${official}

=== FIN DES RÉSULTATS ===
IMPORTANT: Utilise UNIQUEMENT les URLs ci-dessus. Ne génère aucune URL par toi-même.`;

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
