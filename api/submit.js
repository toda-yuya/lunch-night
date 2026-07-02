// api/submit.js — 「お店を投稿」フォームの受け口（Vercel Serverless / Upstash Redis）
// 依存ライブラリ不要。投稿は Redis リスト "submissions" に貯まります。
// 環境変数は vote.js と共通:  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//
// 確認方法: Upstash の「Data Browser」で  LRANGE submissions 0 -1  を実行すると投稿一覧が見られます。
// （任意）管理用GET: 環境変数 SUBMIT_ADMIN_KEY を設定すると /api/submit?key=... で一覧をJSON取得できます。

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN = process.env.SUBMIT_ADMIN_KEY;

async function redis(cmd) {
  const r = await fetch(URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("upstash " + r.status);
  return r.json();
}
function clip(v, n) { return (typeof v === "string" ? v : "").slice(0, n); }

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!URL || !TOKEN) { res.status(500).json({ error: "Upstash env vars not set" }); return; }

  try {
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const name = clip(b.name, 100).trim();
      if (!name) { res.status(400).json({ error: "name required" }); return; }
      const rec = {
        name,
        genre: clip(b.genre, 60),
        mode: b.mode === "night" ? "night" : "lunch",
        comment: clip(b.comment, 300),
        url: clip(b.url, 500),
        ua: clip(req.headers["user-agent"], 200),
        at: new Date().toISOString(),
      };
      await redis([["RPUSH", "submissions", JSON.stringify(rec)]]);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === "GET") {
      if (!ADMIN || req.query.key !== ADMIN) { res.status(403).json({ error: "forbidden" }); return; }
      const out = await redis([["LRANGE", "submissions", "0", "-1"]]);
      const list = (out[0] && out[0].result || []).map((s) => { try { return JSON.parse(s); } catch { return s; } });
      res.status(200).json({ count: list.length, submissions: list });
      return;
    }

    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
