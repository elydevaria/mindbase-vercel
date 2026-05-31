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
    // GET /api/library?userId=xxx — fetch library
    // GET /api/library?userId=xxx&check=1 — check if username exists
    if (method === "GET") {
      const { userId, check } = query;
      if (!userId) return res.status(400).json({ error: "userId required" });

      if (check === "1") {
        // Check if this userId has any saved items (i.e. username is taken)
        const data = await supa(`library?user_id=eq.${encodeURIComponent(userId)}&limit=1&select=id`);
        return res.json({ exists: Array.isArray(data) && data.length > 0 });
      }

      const data = await supa(`library?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`);
      return res.json({ items: Array.isArray(data) ? data : [] });
    }

    // POST /api/library — save item
    if (method === "POST") {
      const { userId, title, tags, note, content } = body;
      if (!userId || !title || !content) return res.status(400).json({ error: "Missing fields" });
      const data = await supa("library", "POST", {
        user_id: userId,
        title,
        tags: tags || [],
        note: note || "",
        content,
      });
      return res.json({ item: Array.isArray(data) ? data[0] : data });
    }

    // DELETE /api/library?id=xxx
    if (method === "DELETE") {
      const { id } = query;
      if (!id) return res.status(400).json({ error: "id required" });
      await supa(`library?id=eq.${id}`, "DELETE");
      return res.json({ success: true });
    }

    res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
