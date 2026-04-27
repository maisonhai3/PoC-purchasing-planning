const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const ANTHROPIC_KEY = defineSecret("ANTHROPIC_API_KEY");

exports.analyze = onRequest(
  { secrets: [ANTHROPIC_KEY], region: "asia-southeast1", cors: true },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    // Auth
    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    let uid;
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Rate limit: 5 requests per user per hour
    const windowStart = Date.now() - 60 * 60 * 1000;
    const limitRef = db.collection("rate_limits").doc(uid);
    const limitDoc = await limitRef.get();
    const limitData = limitDoc.exists
      ? limitDoc.data()
      : { count: 0, window_start: Date.now() };

    if (limitData.window_start > windowStart && limitData.count >= 5) {
      return res.status(429).json({ error: "Quá nhiều yêu cầu. Thử lại sau 1 giờ." });
    }

    const newCount = limitData.window_start > windowStart ? limitData.count + 1 : 1;
    await limitRef.set({
      count: newCount,
      window_start: limitData.window_start > windowStart ? limitData.window_start : Date.now(),
    });

    // Input sanitisation
    const lines = (req.body.lines || [])
      .slice(0, 20)
      .map(l => String(l).trim().slice(0, 200))
      .filter(Boolean);

    if (!lines.length) return res.status(400).json({ error: "No items provided" });

    // Cache lookup (hash of sorted lines)
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify([...lines].sort()))
      .digest("hex");
    const cacheRef = db.collection("cache").doc(hash);
    const cached = await cacheRef.get();
    if (cached.exists) {
      await writeAuditLog(db, uid, lines.length, 0, true, null);
      return res.json({ items: cached.data().items });
    }

    // Call Anthropic (Haiku + tool use for guaranteed valid JSON)
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY.value() });
    const start = Date.now();
    let items, errorMsg = null;

    try {
      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        tools: [{
          name: "score_items",
          input_schema: {
            type: "object",
            required: ["items"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "emoji", "importance", "urgency", "reason"],
                  properties: {
                    name:       { type: "string" },
                    emoji:      { type: "string" },
                    importance: { type: "number", minimum: 1, maximum: 10 },
                    urgency:    { type: "number", minimum: 1, maximum: 10 },
                    reason:     { type: "string" },
                  },
                },
              },
            },
          },
        }],
        tool_choice: { type: "tool", name: "score_items" },
        messages: [{
          role: "user",
          content: `Bạn là chuyên gia tài chính cá nhân. Phân tích các khoản chi tiêu dưới đây theo độ quan trọng (importance 1-10) và độ khẩn cấp (urgency 1-10).\n\nDanh sách:\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
        }],
      });

      items = message.content[0].input.items;

      // Cache write — Firestore TTL policy on `createdAt` field handles expiry (24h)
      await cacheRef.set({ items, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch (e) {
      errorMsg = e.message;
      await writeAuditLog(db, uid, lines.length, Date.now() - start, false, errorMsg);
      return res.status(500).json({ error: "AI error: " + e.message });
    }

    await writeAuditLog(db, uid, lines.length, Date.now() - start, false, null);
    return res.json({ items });
  }
);

async function writeAuditLog(db, uid, itemCount, durationMs, cacheHit, error) {
  await db.collection("audit_logs").add({
    uid,
    itemCount,
    durationMs,
    cacheHit,
    error: error ?? null,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}
