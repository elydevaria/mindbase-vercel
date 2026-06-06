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
      "Prefer": method === "POST" ? "return=representation" : method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json());
}

export default async function handler(req, res) {
  const { method, query } = req;
  console.log("LIBRARY v2:", method, JSON.stringify(query));

  // Parse body — handle all Vercel body formats
  let body = {};
  try {
    if (req.body) {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } else {
      // Read raw body if not parsed
      const raw = await new Promise((resolve) => {
        let data = "";
        req.on("data", chunk => data += chunk);
        req.on("end", () => resolve(data));
      });
      if (raw) body = JSON.parse(raw);
    }
  } catch(e) { body = {}; }

  // ── CONVERSATIONS — must be checked FIRST ──────────────────────
  if (String(query.conversations) === "1") {
    try {
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
        console.log("CONV POST:", JSON.stringify({ userId: !!userId, messages: !!messages, keys: Object.keys(body) }));
        if (!userId || !messages) return res.status(400).json({ error: "Missing fields", got: Object.keys(body) });
        const data = await supa("conversations", "POST", { user_id: userId, title: title || "Nouvelle conversation", messages });
        return res.json(Array.isArray(data) ? data[0] : data);
      }
      if (method === "PATCH") {
        const { id } = query;
        if (!id) return res.status(400).json({ error: "id required" });
        const { title, messages } = body;
        await supa(`conversations?id=eq.${id}`, "PATCH", { ...(title && { title }), ...(messages && { messages }), updated_at: new Date().toISOString() });
        return res.json({ success: true });
      }
      if (method === "DELETE") {
        const { id } = query;
        if (!id) return res.status(400).json({ error: "id required" });
        await supa(`conversations?id=eq.${id}`, "DELETE");
        return res.json({ success: true });
      }
      return res.status(405).json({ error: "Method not allowed" });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

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

      // Supabase returns array on success, object with message on error
      if (data && data.message) return res.status(400).json({ error: data.message });
      if (data && data.code) return res.status(400).json({ error: `Supabase error: ${data.message || data.code}` });

      const item = Array.isArray(data) ? data[0] : data;
      return res.json({ item: item || { success: true } });
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
