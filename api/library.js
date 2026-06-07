export const config = { maxDuration: 10 };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

async function supa(path, method = "GET", body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export default async function handler(req, res) {
  const { method, query } = req;
  const body = req.body || {};

  try {

    // ── CONVERSATIONS ──────────────────────────────────────────────
    if (query.conversations === "1") {

      if (method === "GET") {
        const { userId, id } = query;
        if (id) {
          const data = await supa(`conversations?id=eq.${id}&limit=1&select=*`);
          if (!Array.isArray(data) || !data.length) return res.status(404).json({ error: "Not found" });
          return res.json(data[0]);
        }
        if (!userId) return res.status(400).json({ error: "userId required" });
        const data = await supa(`conversations?user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc&limit=50&select=id,title,created_at,updated_at`);
        return res.json({ conversations: Array.isArray(data) ? data : [] });
      }

      if (method === "POST") {
        const { userId, title, messages } = body;
        if (!userId || !messages) return res.status(400).json({ error: "Missing fields" });
        const data = await supa("conversations", "POST", {
          user_id: userId,
          title: title || "Nouvelle conversation",
          messages,
        });
        return res.json(Array.isArray(data) ? data[0] : data);
      }

      if (method === "PATCH") {
        const { id } = query;
        if (!id) return res.status(400).json({ error: "id required" });
        const { title, messages } = body;
        await supa(`conversations?id=eq.${id}`, "PATCH", {
          ...(title && { title }),
          ...(messages && { messages }),
          updated_at: new Date().toISOString(),
        });
        return res.json({ success: true });
      }

      if (method === "DELETE") {
        const { id } = query;
        if (!id) return res.status(400).json({ error: "id required" });
        await supa(`conversations?id=eq.${id}`, "DELETE");
        return res.json({ success: true });
      }

      return res.status(405).json({ error: "Method not allowed" });
    }

    // ── LIBRARY ────────────────────────────────────────────────────

    if (method === "GET") {
      const { userId, check } = query;
      if (!userId) return res.status(400).json({ error: "userId required" });
      if (check === "1") {
        const data = await supa(`library?user_id=eq.${encodeURIComponent(userId)}&limit=1&select=id`);
        return res.json({ exists: Array.isArray(data) && data.length > 0 });
      }
      const data = await supa(`library?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`);
      return res.json({ items: Array.isArray(data) ? data : [] });
    }

    if (method === "POST") {
      const { userId, title, tags, note, content } = body;
      if (!userId || !title || !content) return res.status(400).json({ error: "Missing fields" });
      const data = await supa("library", "POST", {
        user_id: userId, title, tags: tags || [], note: note || "", content,
      });
      if (data && data.message) return res.status(400).json({ error: data.message });
      if (data && data.code) return res.status(400).json({ error: `Supabase error: ${data.message || data.code}` });
      return res.json({ item: (Array.isArray(data) ? data[0] : data) || { success: true } });
    }

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
