export const config = { maxDuration: 10 };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

function supa(path, method = "GET", body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json());
}

export default async function handler(req, res) {
  const { method, query, body } = req;

  try {
    // GET /api/username?name=xxx — check if available
    if (method === "GET") {
      const { name } = query;
      if (!name) return res.status(400).json({ error: "name required" });
      const data = await supa(`usernames?username=eq.${encodeURIComponent(name)}&limit=1&select=username`);
      return res.json({ available: !Array.isArray(data) || data.length === 0 });
    }

    // POST /api/username — register username
    if (method === "POST") {
      const { name } = body;
      if (!name) return res.status(400).json({ error: "name required" });
      // Try insert — will fail with 409 if already exists (unique constraint)
      const data = await supa("usernames", "POST", { username: name });
      if (data && data.code === "23505") {
        return res.status(409).json({ error: "Nom d'utilisateur déjà pris" });
      }
      if (data && data.message && !Array.isArray(data)) {
        return res.status(400).json({ error: data.message });
      }
      return res.json({ success: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
