# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-file React PoC for a personal finance prioritization app. Users paste a list of spending items; Claude scores each on **importance** and **urgency** (Eisenhower matrix), then ranks them into a priority queue. UI is in Vietnamese.

## Running the PoC

There is no package.json or build config. To run locally:

```bash
# Option A — Vite scratch project
npm create vite@latest app -- --template react
cd app
npm install recharts
# Copy PoC-spending-priority.jsx → src/App.jsx, remove boilerplate
npm run dev
```

Or paste the JSX into a live sandbox (StackBlitz, CodeSandbox) that provides React + Recharts.

## Architecture

**Single component** (`PoC-spending-priority.jsx`) with a step-based state machine:

```
"input"  →  "loading"  →  "results"
```

**Scoring model**

- `score = importance × urgency` (range 1–100)
- Items sorted descending by score
- `quadrantOf(imp, urg)` maps to one of four buckets: `doFirst / schedule / delegate / ignore`

**Three result views** (toggled by `view` state):
- `queue` — ranked card list with score bars
- `visual` — emoji grid
- `matrix` — Recharts `ScatterChart` with `ReferenceArea` quadrants and emoji custom dots

**AI call** — direct `fetch` to `https://api.anthropic.com/v1/messages` from the browser. The prompt asks for a JSON array with `{ name, emoji, importance, urgency, reason }` per item. JSON is parsed with a regex fallback for truncated responses.

## Known Issues (from production_plan.md)

1. **No API key** — fetch sends no `x-api-key` header; returns 401 against the real API. For local testing, add the header manually or mock the response.
2. **Fragile JSON parsing** — the `lastIndexOf` fallback silently drops items if the model output is cut off.
3. **Wrong model** — uses `claude-sonnet-4-20250514`; `claude-haiku-4-5-20251001` is ~12× cheaper and sufficient for this classification task.
4. **No input validation** — raw user text is interpolated directly into the prompt.

## Production Path (summary)

The `production_plan.md` documents the full upgrade plan. Key steps:
1. Move API call behind a **Cloudflare Worker** (holds the API key as a secret)
2. Switch model to **Haiku**
3. Use **Anthropic tool use** (`tool_choice: { type: "tool", name: "score_items" }`) for guaranteed valid JSON instead of regex fallback
4. Add rate limiting and KV-based response caching in the Worker
5. Validate and truncate input server-side (max 20 items, 200 chars each)

Recommended free-tier stack: Cloudflare Pages + Cloudflare Workers + Cloudflare KV.
