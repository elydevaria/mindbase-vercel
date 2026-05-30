export const config = { maxDuration: 60 };

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";

const SYSTEM_PROMPT = `Tu es MindBase, un agent clinique expert en santé mentale dédié aux praticiens français.
Réponds TOUJOURS en français. Tu es un outil d'aide décisionnelle uniquement.`;

async function fetchUrl(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MindBaseBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    // Basic HTML stripping without cheerio (not available in Vercel edge)
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    return { text, title: titleMatch?.[1]?.trim() || url, url };
  } catch (e) {
    return { text: "", title: url, url, error: e.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { urls = [], pdfs = [] } = req.body;
  if (!urls.length && !pdfs.length) return res.status(400).json({ error: "No content provided" });

  const contentParts = [];

  // Fetch URLs
  for (const url of urls.slice(0, 5)) {
    const { text, title, error } = await fetchUrl(url);
    if (error || !text) {
      contentParts.push(`--- URL : ${url}\nImpossible de récupérer le contenu. ---`);
    } else {
      contentParts.push(`--- CONTENU : ${title} (${url}) ---\n${text}`);
    }
  }

  // Add PDF content notes
  for (const pdf of pdfs.slice(0, 5)) {
    contentParts.push(`--- DOCUMENT PDF : ${pdf.name} ---\n[PDF fourni par le praticien — analyser le contenu clinique ci-joint]`);
  }

  const prompt = `Analyse ces ressources cliniques pour un praticien français en santé mentale. Pour chaque ressource :

### Résumé
3-4 phrases essentielles.

### Type et contexte
Nature du document, trouble ciblé, population.

### Points clés pour la pratique
4-5 points directement applicables en clinique.

### Niveau de preuve
Qualité méthodologique, grade de recommandation si applicable.

### Limites
Ce que le praticien doit garder en tête avant d'appliquer.

### Pour aller plus loin
Ressources complémentaires suggérées.

---
${contentParts.join("\n\n")}`;

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
          { role: "user", content: prompt },
        ],
        max_tokens: 2000,
        temperature: 0.2,
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const reply = data.choices?.[0]?.message?.content || "Impossible d'analyser ces ressources.";
    res.json({ reply });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
