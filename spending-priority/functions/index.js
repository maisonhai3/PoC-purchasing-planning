const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const GEMINI_KEY = defineSecret("GEMINI_API_KEY");

exports.analyze = onRequest(
  { secrets: [GEMINI_KEY], region: "asia-southeast1", cors: true },
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

    // Call Gemini with function calling for guaranteed valid JSON
    const genAI = new GoogleGenerativeAI(GEMINI_KEY.value());
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      tools: [{
        functionDeclarations: [{
          name: "score_items",
          description: "Score spending items by importance and urgency for personal finance prioritisation",
          parameters: {
            type: "OBJECT",
            required: ["items"],
            properties: {
              items: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  required: ["name", "emoji", "importance", "urgency", "reason"],
                  properties: {
                    name:       { type: "STRING" },
                    emoji:      { type: "STRING" },
                    importance: { type: "NUMBER" },
                    urgency:    { type: "NUMBER" },
                    reason:     { type: "STRING" },
                  },
                },
              },
            },
          },
        }],
      }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["score_items"] } },
    });

    const start = Date.now();
    let items, errorMsg = null;

    try {
      const result = await model.generateContent(
        `Bạn là chuyên gia tài chính cá nhân. Phân tích các khoản chi tiêu dưới đây theo độ quan trọng (importance 1-10) và độ khẩn cấp (urgency 1-10).\n\nDanh sách:\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`
      );

      const call = result.response.candidates[0].content.parts[0].functionCall;
      items = call.args.items;

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
