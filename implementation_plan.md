# Implementation Plan — Spending Priority PoC (Firebase)

## Goal

Turn `PoC-spending-priority.jsx` into a deployable web app with:
- **Firebase Auth** — Google sign-in gates the analyze feature
- **Firebase Functions** — secure API proxy (replaces direct browser call to Anthropic)
- **Firebase Hosting** — static frontend deployment
- **Firebase Analytics** — custom event tracking
- **Firebase Crashlytics** — client-side error logging
- **Firestore** — per-user rate limiting + server-side audit logs

All infra is free tier. AI cost: ~$0.0006/request (Claude Haiku).

---

## Final Architecture

```
Browser
  ├── Firebase Auth (Google sign-in)
  ├── Firebase Analytics  ← custom events
  └── Firebase Crashlytics  ← unhandled errors
        │  Firebase ID token + { lines[] }
        ▼
  Firebase Function  /analyze
  ├── verifyIdToken()        ← Firebase Admin SDK
  ├── rate limit check       ← Firestore (5 req/user/hour)
  ├── input sanitization     ← max 20 items, 200 chars each
  ├── cache lookup           ← Firestore (hash of sorted lines)
  ├── → Anthropic API        ← Claude Haiku, tool use
  ├── cache write            ← TTL 24h
  └── audit log write        ← Firestore
```

---

## Prerequisites

- Node.js 20+
- A Google account
- Firebase CLI: `npm install -g firebase-tools`
- Anthropic API key (from console.anthropic.com)

---

## Phase 0 — Project Setup

### 0.1 Create Firebase project

1. Go to console.firebase.google.com → **Add project**
2. Name it `spending-priority`
3. Enable Google Analytics when prompted (same project, no extra config)
4. In **Authentication** → Sign-in method → enable **Google**
5. In **Firestore Database** → Create database → Start in **production mode** → choose region (e.g. `asia-southeast1`)
6. In **Project settings** → Your apps → **Add web app** → copy the `firebaseConfig` object

### 0.2 Scaffold the Vite project

```bash
npm create vite@latest spending-priority -- --template react
cd spending-priority
npm install
npm install recharts firebase
npm install -D firebase-tools
```

### 0.3 Initialize Firebase in the project

```bash
firebase login
firebase init
```

Select:
- **Hosting** → `dist` as public dir, SPA: yes
- **Functions** → JavaScript, ESLint: yes
- **Firestore** → use defaults
- Do NOT overwrite existing files if prompted

### 0.4 Project structure after setup

```
spending-priority/
├── src/
│   ├── main.jsx
│   ├── App.jsx          ← ported from PoC-spending-priority.jsx
│   ├── firebase.js      ← Firebase SDK init
│   └── components/
│       └── AuthGate.jsx
├── functions/
│   ├── index.js         ← Firebase Function (API proxy)
│   └── package.json
├── firebase.json
└── .env                 ← VITE_FIREBASE_* vars (never commit)
```

---

## Phase 1 — Port the PoC

Copy `PoC-spending-priority.jsx` to `src/App.jsx`.

Remove the `fetch("https://api.anthropic.com/...")` block — it moves to the Firebase Function in Phase 3. For now, replace it with a stub:

```js
async function analyze() {
  // Phase 3 will replace this with a Firebase Function call
  console.log("analyze() called — Function not wired yet");
}
```

Run `npm run dev` and verify the UI renders, views switch, and loading state works.

---

## Phase 2 — Firebase Auth

### 2.1 Initialize Firebase SDK

```js
// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  // paste from Firebase console
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
```

### 2.2 Auth gate component

```jsx
// src/components/AuthGate.jsx
import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../firebase";

export default function AuthGate() {
  return (
    <div style={{ textAlign: "center", padding: "3rem 1rem", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <h2 style={{ fontWeight: 800, fontSize: 24, marginBottom: 8 }}>Nên chi tiền vào đâu?</h2>
      <p style={{ color: "#777", marginBottom: 24, fontSize: 14 }}>
        Đăng nhập để dùng công cụ phân tích chi tiêu AI.
      </p>
      <button
        onClick={() => signInWithPopup(auth, googleProvider)}
        style={{
          padding: "12px 24px", fontSize: 15, fontWeight: 700,
          background: "#1a1a1a", color: "white",
          border: "none", borderRadius: 10, cursor: "pointer",
        }}
      >
        Đăng nhập với Google →
      </button>
    </div>
  );
}
```

### 2.3 Wire auth state in App.jsx

```jsx
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebase";
import AuthGate from "./components/AuthGate";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  if (user === undefined) return null; // brief auth loading flash
  if (!user) return <AuthGate />;

  // existing App UI continues here — add a sign-out button in the header
}
```

Add a sign-out button in the results header:
```jsx
<button onClick={() => signOut(auth)} style={{ fontSize: 12, color: "#aaa", background: "none", border: "none", cursor: "pointer" }}>
  Đăng xuất
</button>
```

---

## Phase 3 — Firebase Function (API Proxy)

All Anthropic API communication moves here. The client never touches the Anthropic API directly.

### 3.1 Install dependencies in functions/

```bash
cd functions
npm install firebase-admin @anthropic-ai/sdk
```

### 3.2 Store the Anthropic API key as a secret

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
# paste your key when prompted
```

### 3.3 Write the Function

```js
// functions/index.js
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

    // — Auth —
    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    let uid;
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    // — Rate limit: 5 requests per user per hour —
    const windowStart = Date.now() - 60 * 60 * 1000;
    const limitRef = db.collection("rate_limits").doc(uid);
    const limitDoc = await limitRef.get();
    const limitData = limitDoc.exists ? limitDoc.data() : { count: 0, window_start: Date.now() };

    if (limitData.window_start > windowStart && limitData.count >= 5) {
      return res.status(429).json({ error: "Quá nhiều yêu cầu. Thử lại sau 1 giờ." });
    }

    const newCount = limitData.window_start > windowStart ? limitData.count + 1 : 1;
    await limitRef.set({ count: newCount, window_start: limitData.window_start > windowStart ? limitData.window_start : Date.now() });

    // — Input sanitization —
    let lines = (req.body.lines || [])
      .slice(0, 20)
      .map(l => String(l).trim().slice(0, 200))
      .filter(Boolean);

    if (!lines.length) return res.status(400).json({ error: "No items provided" });

    // — Cache lookup (hash of sorted lines) —
    const hash = crypto.createHash("sha256").update(JSON.stringify([...lines].sort())).digest("hex");
    const cacheRef = db.collection("cache").doc(hash);
    const cached = await cacheRef.get();
    if (cached.exists) {
      await writeAuditLog(db, uid, lines.length, 0, true, null);
      return res.json({ items: cached.data().items });
    }

    // — Call Anthropic (Haiku + tool use) —
    const client = new Anthropic.default({ apiKey: ANTHROPIC_KEY.value() });
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

      // Cache write (TTL 24h)
      await cacheRef.set({ items, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      // Firestore TTL policy must be set on `createdAt` field for the `cache` collection in the console
    } catch (e) {
      errorMsg = e.message;
      return res.status(500).json({ error: "AI error: " + e.message });
    } finally {
      await writeAuditLog(db, uid, lines.length, Date.now() - start, false, errorMsg);
    }

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
```

### 3.4 Update the client's analyze() to call the Function

```js
// src/App.jsx — replace the analyze() function body
async function analyze() {
  const lines = inputText.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;
  setStep("loading");
  setError(null);
  // ... loading interval (keep as-is) ...

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch("https://asia-southeast1-YOUR_PROJECT_ID.cloudfunctions.net/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ lines }),
    });
    clearInterval(iv);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const scored = data.items
      .map(item => ({
        ...item,
        score: item.importance * item.urgency,
        quadrant: quadrantOf(item.importance, item.urgency),
        x: item.urgency,
        y: item.importance,
      }))
      .sort((a, b) => b.score - a.score);

    setItems(scored);
    setStep("results");
  } catch (e) {
    clearInterval(iv);
    setError("Có lỗi: " + e.message);
    setStep("input");
  }
}
```

Replace `YOUR_PROJECT_ID` with your Firebase project ID, or use the emulator URL during development.

---

## Phase 4 — Firebase Analytics

### 4.1 Initialize in firebase.js

```js
import { getAnalytics, logEvent } from "firebase/analytics";
export const analytics = getAnalytics(app);
```

### 4.2 Add events in App.jsx

```js
import { logEvent } from "firebase/analytics";
import { analytics } from "./firebase";

// In analyze(), after setStep("results"):
logEvent(analytics, "analyze_submitted", { item_count: lines.length });

// When view changes:
logEvent(analytics, "results_viewed", { view }); // call this in the view toggle onClick

// After scoring, compute quadrant counts:
const quadrantCounts = scored.reduce((acc, item) => {
  acc[item.quadrant] = (acc[item.quadrant] || 0) + 1;
  return acc;
}, {});
logEvent(analytics, "quadrant_distribution", quadrantCounts);

// In the catch block:
logEvent(analytics, "error_occurred", { error_type: "analyze_failed" });
```

---

## Phase 5 — Firebase Crashlytics

Crashlytics for web works via the Firebase Performance + compat SDK. Add to `index.html`:

```html
<!-- index.html <head> -->
<script src="/__/firebase/init.js"></script>
```

Then in `src/main.jsx`:

```js
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

// Crashlytics web: wrap the root render in a global error handler
window.addEventListener("unhandledrejection", (event) => {
  // Firebase Crashlytics web SDK logs these automatically once initialized
  console.error("Unhandled rejection:", event.reason);
});
```

> **Note**: Full Crashlytics symbolication for web requires `@firebase/crashlytics` (currently in beta for web). For now, unhandled errors are captured via Analytics `error_occurred` events and the Function's audit log. Revisit when the web SDK stabilises.

---

## Phase 6 — Firestore Security Rules

```
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users cannot read or write rate limits or audit logs directly
    match /rate_limits/{uid} {
      allow read, write: if false;
    }
    match /audit_logs/{doc} {
      allow read, write: if false;
    }
    match /cache/{hash} {
      allow read, write: if false;
    }
  }
}
```

All Firestore access goes through the Function (Admin SDK bypasses rules).

---

## Phase 7 — Deploy

### 7.1 Build and deploy

```bash
# Build frontend
npm run build

# Deploy everything
firebase deploy
```

This deploys:
- Frontend → Firebase Hosting (`dist/`)
- Function → Firebase Functions (`functions/`)
- Firestore rules → Firestore

### 7.2 Set Firestore TTL for cache collection

In Firebase console → Firestore → **TTL policies** → Add policy:
- Collection: `cache`
- Field: `createdAt`
- TTL: `86400` seconds (24h)

This auto-deletes cached responses after 24 hours.

---

## Phase 8 — Local Development

```bash
# Terminal 1 — Vite dev server
npm run dev

# Terminal 2 — Firebase emulators (Functions + Firestore)
firebase emulators:start --only functions,firestore
```

Point `analyze()` fetch URL to `http://localhost:5001/YOUR_PROJECT_ID/asia-southeast1/analyze` during local dev. Use an env var:

```js
// src/App.jsx
const FUNCTION_URL = import.meta.env.DEV
  ? "http://localhost:5001/YOUR_PROJECT_ID/asia-southeast1/analyze"
  : "https://asia-southeast1-YOUR_PROJECT_ID.cloudfunctions.net/analyze";
```

---

## Final Stack

| Layer | Tool | Cost |
|---|---|---|
| Hosting | Firebase Hosting | Free |
| API proxy + rate limit | Firebase Functions | Free (2M invocations/month) |
| Auth | Firebase Auth (Google) | Free (10k/month) |
| Analytics | Firebase Analytics / GA4 | Free |
| Error logging | Crashlytics (+ Analytics events) | Free |
| Cache + audit logs | Firestore | Free (50k reads, 20k writes/day) |
| AI model | Claude Haiku 4.5 | ~$0.0006/request |

**Total infra: $0. AI: ~$0.63 per 1,000 requests.**

---

## Implementation Order Summary

| Phase | Task | Effort |
|---|---|---|
| 0 | Firebase project + Vite scaffold + `firebase init` | ~30 min |
| 1 | Port PoC JSX, verify UI in dev | ~15 min |
| 2 | Firebase Auth + AuthGate component | ~30 min |
| 3 | Firebase Function (proxy + rate limit + cache + audit log) | ~1.5h |
| 4 | Analytics events | ~20 min |
| 5 | Crashlytics / error handling | ~15 min |
| 6 | Firestore security rules | ~10 min |
| 7 | Deploy + set Firestore TTL | ~15 min |

**Total: ~4 hours** for a production-ready deployment.
