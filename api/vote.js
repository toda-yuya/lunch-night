// api/vote.js  —  西新宿ランチ＆飲み診断：喫煙可否／入りやすさ のユーザー投稿集計
// Vercel Serverless Function（Node.js）。依存ライブラリ不要（Upstash REST を fetch で直接叩く）。
//
// 必要な環境変数（Vercel > Settings > Environment Variables に登録）:
//   UPSTASH_REDIS_REST_URL    例) https://xxxx.upstash.io
//   UPSTASH_REDIS_REST_TOKEN  Upstashの REST TOKEN
//
// エンドポイント:
//   GET  /api/vote?ids=ID1,ID2,...   → { ID1:{smoking:{可,分煙,不可}, ease:{入りやすい,ふつう,並ぶ}}, ... }
//   POST /api/vote  body: {id, field:"smoking"|"ease", value:"可"| ...}  → { ok:true, agg:{...} }

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const FIELDS = {
  smoking: { key: "smk", values: ["可", "分煙", "不可"] },
  ease:    { key: "ease", values: ["入りやすい", "ふつう", "並ぶ"] },
};

function blank() {
  return {
    smoking: { "可": 0, "分煙": 0, "不可": 0 },
    ease: { "入りやすい": 0, "ふつう": 0, "並ぶ": 0 },
  };
}
function cleanId(id) {
  // place_id 等の安全な文字だけ許可
  return (typeof id === "string" ? id : "").replace(/[^A-Za-z0-9_\-]/g, "").slice(0, 128);
}
async function pipeline(cmds) {
  const r = await fetch(URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("upstash " + r.status);
  return r.json(); // [{result:...}, ...]
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (!URL || !TOKEN) {
    res.status(500).json({ error: "Upstash env vars not set" });
    return;
  }

  try {
    if (req.method === "GET") {
      const idsRaw = (req.query.ids || "").toString();
      const ids = idsRaw.split(",").map(cleanId).filter(Boolean).slice(0, 60);
      if (!ids.length) { res.status(200).json({}); return; }

      const cmds = [];
      ids.forEach((id) => {
        cmds.push(["HGETALL", "smk:" + id]);
        cmds.push(["HGETALL", "ease:" + id]);
      });
      const results = await pipeline(cmds);

      const out = {};
      ids.forEach((id, i) => {
        const agg = blank();
        const smk = arrToObj(results[i * 2] && results[i * 2].result);
        const ease = arrToObj(results[i * 2 + 1] && results[i * 2 + 1].result);
        for (const k in agg.smoking) agg.smoking[k] = parseInt(smk[k] || 0, 10) || 0;
        for (const k in agg.ease) agg.ease[k] = parseInt(ease[k] || 0, 10) || 0;
        out[id] = agg;
      });
      res.status(200).json(out);
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const id = cleanId(body.id);
      const field = body.field;
      const value = body.value;
      const def = FIELDS[field];
      if (!id || !def || def.values.indexOf(value) < 0) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      const rkey = def.key + ":" + id;
      const results = await pipeline([
        ["HINCRBY", rkey, value, 1],
        ["HGETALL", "smk:" + id],
        ["HGETALL", "ease:" + id],
      ]);
      const agg = blank();
      const smk = arrToObj(results[1] && results[1].result);
      const ease = arrToObj(results[2] && results[2].result);
      for (const k in agg.smoking) agg.smoking[k] = parseInt(smk[k] || 0, 10) || 0;
      for (const k in agg.ease) agg.ease[k] = parseInt(ease[k] || 0, 10) || 0;
      res.status(200).json({ ok: true, agg });
      return;
    }

    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}

// Upstash の HGETALL は ["field","value","field","value",...] 形式で返る
function arrToObj(arr) {
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  else if (arr && typeof arr === "object") return arr; // 念のためオブジェクト形式にも対応
  return o;
}
