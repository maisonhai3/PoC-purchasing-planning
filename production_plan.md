# Production Plan — Purchasing Priority App

## Code Analysis

### Critical Issues

**1. API key exposed / missing (fatal)**
The fetch call sends no `x-api-key` header — the real Anthropic API returns 401. In any working
version, the key would need to be embedded in the JS bundle, making it trivially extractable from
DevTools. Anyone who finds it can burn the entire quota.

**2. No input validation or abuse prevention**
A user can paste 500 lines, or craft a prompt injection via item text. The server-side prompt
concatenates raw user input directly with no sanitization.

**3. Fragile JSON parsing**
The fallback (`lastIndexOf`, slicing) silently truncates items if the model output is cut off.
This produces wrong results with no user feedback.

**4. Wrong model for cost**
`claude-sonnet-4-20250514` costs ~$3/$15 per MTok (in/out). For this classification task, Haiku
is ~12× cheaper and more than capable.

---

## Production-Grade Proposals (ordered by priority)

### 1. Secure the API key with a serverless proxy

The only real requirement is a thin function that holds the key server-side and forwards requests.
**Cloudflare Workers** is the best fit:

- Free tier: 100k requests/day, no cold starts, global edge
- API key stored as a Worker secret (never in client bundle)
- ~30 lines of code

```
Browser  →  POST /api/analyze  →  Cloudflare Worker  →  Anthropic API
```

Alternatives if already on another host: Vercel Functions or Netlify Functions (free tier ~125k/mo).

**Worker skeleton:**

```js
export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const { lines } = await request.json();

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ /* prompt payload */ }),
    });

    return new Response(await resp.text(), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
```

---

### 2. Switch to Haiku (12× cost reduction)

```diff
- model: "claude-sonnet-4-20250514"
+ model: "claude-haiku-4-5-20251001"
```

For a 10-item list (~500 input + ~400 output tokens):

| Model  | Cost/request |
|--------|-------------|
| Sonnet | ~$0.0075    |
| Haiku  | ~$0.00063   |

At 1,000 requests/month: Sonnet = $7.50 vs Haiku = $0.63.

Haiku handles simple scoring/classification with no quality loss vs Sonnet.

---

### 3. Rate limiting + cost cap (in the Worker)

```js
// Using Cloudflare KV: key = ip, value = { count, window_start }
const MAX_REQUESTS_PER_HOUR = 5;
const MAX_ITEMS_PER_REQUEST  = 20;
```

Also set a hard monthly spend limit in the Anthropic dashboard (free, prevents runaway bills).

---

### 4. Response caching (near-zero cost on repeat inputs)

Hash the sorted item list → check Cloudflare KV before calling Anthropic. Identical lists return
instantly for free.

```
hash(sorted_lines) → KV.get(hash) → return cached  OR  call API → KV.put(hash, result, { expirationTtl: 86400 })
```

KV free tier: 100k reads/day, 1k writes/day — sufficient for this use case.

---

### 5. Fix JSON parsing with tool use (structured output)

Replace the regex-fallback approach with Anthropic's tool use, which guarantees valid JSON:

```js
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
```

Parse from `data.content[0].input.items` instead of `data.content[0].text`. No fallback needed.

---

### 6. Server-side input sanitization (in the Worker)

```js
const lines = body.lines
  .slice(0, 20)                        // hard cap
  .map(l => String(l).trim().slice(0, 200));  // truncate long items

if (!lines.length) return error(400, "No items provided");
```

---

## Recommended Stack (all free tier)

| Layer          | Tool               | Cost                     |
|----------------|--------------------|--------------------------|
| Hosting        | Cloudflare Pages   | Free                     |
| API proxy      | Cloudflare Worker  | Free (100k req/day)      |
| Rate limit / cache | Cloudflare KV  | Free (100k reads/day)    |
| AI model       | Claude Haiku 4.5   | ~$0.0006/request         |

**Total infra cost: $0. AI cost: ~$0.63 per 1,000 requests.**

---

## What Does NOT Need Changing

The core UX (queue / visual / matrix views), the Eisenhower quadrant scoring logic, the
Vietnamese copy, and the Recharts matrix are all solid. These are not production problems.
