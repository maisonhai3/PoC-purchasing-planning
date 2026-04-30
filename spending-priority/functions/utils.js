const crypto = require("crypto");

const MAX_ITEMS = 20;
const MAX_ITEM_LENGTH = 200;

function sanitizeInput(rawLines) {
  return (rawLines || [])
    .slice(0, MAX_ITEMS)
    .map(line => String(line).trim().slice(0, MAX_ITEM_LENGTH))
    .filter(Boolean);
}

function computeCacheKey(lines) {
  // Sort so ["A","B"] and ["B","A"] map to the same cache entry
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([...lines].sort()))
    .digest("hex");
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

// MAX_ITEMS and MAX_ITEM_LENGTH are exported for use in unit tests
module.exports = { sanitizeInput, computeCacheKey, buildPrompt, buildScoringTool, MAX_ITEMS, MAX_ITEM_LENGTH };
