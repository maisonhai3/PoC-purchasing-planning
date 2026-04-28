const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const GEMINI_KEY = defineSecret("GEMINI_API_KEY");

const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_ITEMS = 20;
const MAX_ITEM_LENGTH = 200;

exports.analyze = onRequest(
  { secrets: [GEMINI_KEY], region: "asia-southeast1", cors: true },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    let uid;
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    const rateLimitError = await checkRateLimit(uid);
    if (rateLimitError) return res.status(429).json({ error: rateLimitError });

    const lines = sanitizeInput(req.body.lines);
    if (!lines.length) return res.status(400).json({ error: "No items provided" });

    const cacheRef = db.collection("cache").doc(computeCacheKey(lines));
    const cached = await cacheRef.get();
    if (cached.exists) {
      await writeAuditLog(db, uid, lines.length, 0, true, null);
      return res.json({ items: cached.data().items });
    }

    const start = Date.now();
    let items;

    try {
      items = await callGemini(lines);
      // Firestore TTL policy on `createdAt` handles cache expiry (24h)
      await cacheRef.set({ items, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch (err) {
      await writeAuditLog(db, uid, lines.length, Date.now() - start, false, err.message);
      return res.status(500).json({ error: `AI error: ${err.message}` });
    }

    await writeAuditLog(db, uid, lines.length, Date.now() - start, false, null);
    return res.json({ items });
  }
);

async function checkRateLimit(uid) {
  const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;
  const limitRef = db.collection("rate_limits").doc(uid);
  const limitDoc = await limitRef.get();
  const limitData = limitDoc.exists
    ? limitDoc.data()
    : { count: 0, window_start: Date.now() };

  if (limitData.window_start > windowStart && limitData.count >= RATE_LIMIT_MAX_REQUESTS) {
    return "Quá nhiều yêu cầu. Thử lại sau 1 giờ.";
  }

  const newCount = limitData.window_start > windowStart ? limitData.count + 1 : 1;
  await limitRef.set({
    count: newCount,
    window_start: limitData.window_start > windowStart ? limitData.window_start : Date.now(),
  });

  return null;
}

function sanitizeInput(rawLines) {
  return (rawLines || [])
    .slice(0, MAX_ITEMS)
    .map(line => String(line).trim().slice(0, MAX_ITEM_LENGTH))
    .filter(Boolean);
}

function computeCacheKey(lines) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([...lines].sort()))
    .digest("hex");
}

async function callGemini(lines) {
  const genAI = new GoogleGenerativeAI(GEMINI_KEY.value());
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    tools: [buildScoringTool()],
    toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["score_items"] } },
  });

  const result = await model.generateContent(buildPrompt(lines));
  const call = result.response.candidates[0].content.parts[0].functionCall;
  return call.args.items;
}

function buildPrompt(lines) {
  const itemList = lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
  return `Bạn là chuyên gia tài chính cá nhân. Phân tích các khoản chi tiêu dưới đây theo độ quan trọng (importance 1-10) và độ khẩn cấp (urgency 1-10).\n\nDanh sách:\n${itemList}`;
}

function buildScoringTool() {
  return {
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
  };
}

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
