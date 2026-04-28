import { useState, useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  ScatterChart, Scatter, XAxis, YAxis,
  ReferenceArea, ReferenceLine, Tooltip,
  ResponsiveContainer
} from "recharts";
import { logEvent } from "firebase/analytics";
import { auth, analytics } from "./firebase";
import AuthGate from "./components/AuthGate";

const LOADING_INTERVAL_MS = 900;
const LOADING_MESSAGES = [
  "AI đang đọc danh sách...",
  "Đang cân nhắc độ quan trọng...",
  "Đang đánh giá mức độ khẩn cấp...",
  "Đang xếp hạng ưu tiên...",
];

const QUADRANT_MIDPOINT = 5;
const TOP_RANK_COUNT = 3;
const SCORE_HIGH_THRESHOLD = 0.6;
const SCORE_MID_THRESHOLD = 0.35;

const VIEW_OPTIONS = [
  { id: "queue",  label: "Hàng đợi" },
  { id: "visual", label: "Tối giản" },
  { id: "matrix", label: "Ma trận" },
];

const SAMPLE = `iPhone 16 Pro Max
Học phí khóa lập trình online
Tiền thuê nhà tháng tới
Ăn nhà hàng với bạn bè
Tai nghe AirPods Pro
Khám sức khỏe định kỳ
Sách Clean Code & DDIA
Netflix subscription
Sửa xe máy (hỏng phanh)
Mua bộ bàn phím cơ`;

function quadrantOf(importance, urgency) {
  if (importance >= QUADRANT_MIDPOINT && urgency >= QUADRANT_MIDPOINT) return "doFirst";
  if (importance >= QUADRANT_MIDPOINT && urgency < QUADRANT_MIDPOINT) return "schedule";
  if (importance < QUADRANT_MIDPOINT && urgency >= QUADRANT_MIDPOINT) return "delegate";
  return "ignore";
}

const QUADRANTS = {
  doFirst:  { label: "Làm ngay",       color: "#c0392b", bg: "#fdf0ef", border: "#e74c3c" },
  schedule: { label: "Lên kế hoạch",   color: "#9a6200", bg: "#fdf6e3", border: "#f0a500" },
  delegate: { label: "Cân nhắc",       color: "#1a5fa8", bg: "#eef4fc", border: "#3b82f6" },
  ignore:   { label: "Bỏ qua",         color: "#5a5a58", bg: "#f4f4f2", border: "#aaa" },
};

const QUADRANT_AREAS = [
  { key: "schedule", x1: 0, x2: 5, y1: 5, y2: 10, fill: "#fffbec" },
  { key: "doFirst",  x1: 5, x2: 10, y1: 5, y2: 10, fill: "#fff0ef" },
  { key: "ignore",   x1: 0, x2: 5, y1: 0, y2: 5,  fill: "#f8f8f6" },
  { key: "delegate", x1: 5, x2: 10, y1: 0, y2: 5,  fill: "#eef5ff" },
];

function getFunctionUrl() {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  return import.meta.env.DEV
    ? `http://localhost:5001/${projectId}/asia-southeast1/analyze`
    : `https://asia-southeast1-${projectId}.cloudfunctions.net/analyze`;
}

function scoreItems(rawItems) {
  return rawItems
    .map(item => ({
      ...item,
      score: item.importance * item.urgency,
      quadrant: quadrantOf(item.importance, item.urgency),
      x: item.urgency,
      y: item.importance,
    }))
    .sort((a, b) => b.score - a.score);
}

const CustomDot = ({ cx, cy, payload }) => (
  <text
    x={cx} y={cy}
    textAnchor="middle"
    dominantBaseline="middle"
    fontSize={20}
    style={{ userSelect: "none", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.15))" }}
  >
    {payload.emoji}
  </text>
);

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  const quadrant = QUADRANTS[item.quadrant];
  return (
    <div style={{
      background: "white", border: `1.5px solid ${quadrant.border}`,
      borderRadius: 10, padding: "10px 14px", fontSize: 13,
      boxShadow: "0 8px 24px rgba(0,0,0,0.10)", maxWidth: 230,
    }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{item.emoji} {item.name}</div>
      <div style={{ color: "#777", marginBottom: 8, lineHeight: 1.5 }}>{item.reason}</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 6, fontSize: 12 }}>
        <span style={{ background: "#f5f5f3", padding: "2px 8px", borderRadius: 6 }}>
          Quan trọng: <b>{item.importance}</b>
        </span>
        <span style={{ background: "#f5f5f3", padding: "2px 8px", borderRadius: 6 }}>
          Khẩn cấp: <b>{item.urgency}</b>
        </span>
      </div>
      <div style={{
        display: "inline-block", padding: "3px 10px", borderRadius: 20,
        background: quadrant.bg, color: quadrant.color, fontWeight: 600, fontSize: 12,
      }}>
        {quadrant.label}
      </div>
    </div>
  );
};

function ScoreBar({ score, max }) {
  const ratio = score / max;
  const percentage = Math.round(ratio * 100);
  const quadrantKey = ratio > SCORE_HIGH_THRESHOLD ? "doFirst" : ratio > SCORE_MID_THRESHOLD ? "schedule" : "ignore";
  return (
    <div style={{ height: 4, borderRadius: 2, background: "#efefed", overflow: "hidden", marginTop: 8 }}>
      <div style={{
        height: "100%", width: `${percentage}%`,
        background: QUADRANTS[quadrantKey].color, borderRadius: 2,
        transition: "width 0.6s ease",
      }} />
    </div>
  );
}

function LoadingView({ message }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: 280,
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .loader { animation: spin 1.2s linear infinite; font-size: 36px; margin-bottom: 20px; }
        .msg { animation: pulse 1.8s ease-in-out infinite; }
      `}</style>
      <div className="loader">⚙️</div>
      <div className="msg" style={{ fontSize: 15, fontWeight: 600, color: "#333" }}>{message}</div>
      <div style={{ fontSize: 12, color: "#aaa", marginTop: 6 }}>AI đang nghĩ...</div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [step, setStep] = useState("input");
  const [inputText, setInputText] = useState(SAMPLE);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [view, setView] = useState("queue");
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  function handleSignOut() { signOut(auth); }

  function handleReset() {
    setStep("input");
    setItems([]);
  }

  function handleViewChange(newView) {
    setView(newView);
    logEvent(analytics, "results_viewed", { view: newView });
  }

  async function analyze() {
    const lines = inputText.split("\n").map(line => line.trim()).filter(Boolean);
    if (!lines.length) return;

    setStep("loading");
    setError(null);

    let msgIndex = 0;
    const intervalId = setInterval(() => {
      msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length;
      setLoadingMsg(LOADING_MESSAGES[msgIndex]);
    }, LOADING_INTERVAL_MS);

    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(getFunctionUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lines }),
      });
      clearInterval(intervalId);

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const scored = scoreItems(data.items);
      setItems(scored);
      setStep("results");

      logEvent(analytics, "analyze_submitted", { item_count: lines.length });

      const quadrantCounts = scored.reduce((acc, item) => {
        acc[item.quadrant] = (acc[item.quadrant] || 0) + 1;
        return acc;
      }, {});
      logEvent(analytics, "quadrant_distribution", quadrantCounts);
    } catch (err) {
      clearInterval(intervalId);
      setError(`Có lỗi: ${err.message}`);
      setStep("input");
      logEvent(analytics, "error_occurred", { error_type: "analyze_failed" });
    }
  }

  if (user === undefined) return null; // brief auth-loading flash
  if (!user) return <AuthGate />;

  if (step === "loading") return <LoadingView message={loadingMsg} />;

  if (step === "input") return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", maxWidth: 560, margin: "0 auto", padding: "2rem 1rem" }}>
      <style>{`
        textarea:focus { outline: none; border-color: #1a1a1a !important; }
        .analyze-btn:hover { background: #333 !important; }
        .analyze-btn:active { transform: scale(0.98); }
      `}</style>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <button
          onClick={handleSignOut}
          style={{ fontSize: 12, color: "#aaa", background: "none", border: "none", cursor: "pointer" }}
        >
          Đăng xuất ({user.displayName || user.email})
        </button>
      </div>

      <div style={{ marginBottom: "1.75rem" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#aaa", textTransform: "uppercase", marginBottom: 10 }}>
          AI · Ma trận Eisenhower · Chi tiêu
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0, lineHeight: 1.15, letterSpacing: "-0.02em" }}>
          Nên chi tiền vào đâu?
        </h1>
        <p style={{ fontSize: 14, color: "#777", marginTop: 10, lineHeight: 1.65 }}>
          Liệt kê những thứ bạn đang phân vân. AI sẽ đánh giá <b>độ quan trọng</b> &amp;
          <b> độ khẩn cấp</b>, rồi xếp hàng đợi ưu tiên cho bạn.
        </p>
      </div>

      <div style={{ position: "relative" }}>
        <textarea
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          placeholder={"Mỗi dòng một khoản chi tiêu...\n\nVí dụ:\nTiền thuê nhà\niPhone mới\nHọc phí lập trình"}
          style={{
            width: "100%", minHeight: 240, padding: "14px 16px",
            fontSize: 14, lineHeight: 2, border: "1.5px solid #e0e0de",
            borderRadius: 12, resize: "vertical", fontFamily: "inherit",
            boxSizing: "border-box", background: "#fafaf8", color: "#1a1a1a",
            transition: "border-color 0.2s",
          }}
        />
        <div style={{
          position: "absolute", bottom: 12, right: 14,
          fontSize: 11, color: "#bbb",
        }}>
          {inputText.split("\n").filter(line => line.trim()).length} mục
        </div>
      </div>

      {error && (
        <div style={{ color: "#c0392b", fontSize: 13, marginTop: 8, padding: "8px 12px", background: "#fdf0ef", borderRadius: 8 }}>
          {error}
        </div>
      )}

      <button
        className="analyze-btn"
        onClick={analyze}
        style={{
          marginTop: 14, width: "100%", padding: "15px",
          fontSize: 15, fontWeight: 700, background: "#1a1a1a",
          color: "white", border: "none", borderRadius: 10,
          cursor: "pointer", letterSpacing: "0.01em", transition: "background 0.2s",
        }}
      >
        Phân tích ngay →
      </button>

      <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "center" }}>
        {Object.entries(QUADRANTS).map(([key, quadrant]) => (
          <span key={key} style={{
            fontSize: 11, padding: "3px 9px", borderRadius: 20,
            background: quadrant.bg, color: quadrant.color, fontWeight: 600,
          }}>
            {quadrant.label}
          </span>
        ))}
      </div>
    </div>
  );

  const maxScore = Math.max(...items.map(item => item.score));

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", maxWidth: 680, margin: "0 auto", padding: "1.5rem 1rem" }}>
      <style>{`
        .item-card:hover { border-color: #ccc !important; transform: translateX(2px); }
        .view-btn { transition: all 0.15s; }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
        <div>
          <div style={{ fontSize: 11, color: "#aaa", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Kết quả · {items.length} khoản
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 2 }}>
            Priority Queue
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={handleSignOut}
            style={{ fontSize: 12, color: "#aaa", background: "none", border: "none", cursor: "pointer", marginRight: 4 }}
          >
            Đăng xuất
          </button>
          {VIEW_OPTIONS.map(({ id, label }) => (
            <button
              key={id}
              className="view-btn"
              onClick={() => handleViewChange(id)}
              style={{
                padding: "7px 14px", fontSize: 13, fontWeight: 600,
                borderRadius: 8, cursor: "pointer",
                border: view === id ? "none" : "1.5px solid #e0e0de",
                background: view === id ? "#1a1a1a" : "white",
                color: view === id ? "white" : "#555",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Quadrant legend pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {Object.entries(QUADRANTS).map(([key, quadrant]) => (
          <span key={key} style={{
            fontSize: 11, padding: "3px 10px", borderRadius: 20,
            background: quadrant.bg, color: quadrant.color, fontWeight: 600,
            border: `1px solid ${quadrant.border}22`,
          }}>
            {quadrant.label}
          </span>
        ))}
      </div>

      {/* Queue View */}
      {view === "queue" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {items.map((item, index) => {
            const quadrant = QUADRANTS[item.quadrant];
            const isTop = index === 0;
            return (
              <div
                key={`${item.name}-${index}`}
                className="item-card"
                style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "13px 16px",
                  background: isTop ? quadrant.bg : "white",
                  border: `1.5px solid ${isTop ? quadrant.border : "#e8e8e6"}`,
                  borderRadius: 12,
                  borderLeft: `4px solid ${quadrant.color}`,
                  transition: "all 0.15s",
                  position: "relative",
                }}
              >
                <div style={{
                  minWidth: 28, height: 28, borderRadius: "50%",
                  background: index < TOP_RANK_COUNT ? quadrant.color : "#efefed",
                  color: index < TOP_RANK_COUNT ? "white" : "#aaa",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 800, flexShrink: 0, marginTop: 1,
                }}>
                  {index + 1}
                </div>
                <div style={{ fontSize: 24, minWidth: 30, textAlign: "center", flexShrink: 0 }}>
                  {item.emoji}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>
                      {item.name}
                    </span>
                    <span style={{
                      fontSize: 11, padding: "3px 9px", borderRadius: 20, flexShrink: 0,
                      background: quadrant.bg, color: quadrant.color, fontWeight: 700,
                      border: `1px solid ${quadrant.border}33`,
                    }}>
                      {quadrant.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 3, lineHeight: 1.55 }}>
                    {item.reason}
                  </div>
                  <div style={{ display: "flex", gap: 14, marginTop: 7, fontSize: 12 }}>
                    <span style={{ color: "#777" }}>
                      Quan trọng: <b style={{ color: "#1a1a1a" }}>{item.importance}/10</b>
                    </span>
                    <span style={{ color: "#777" }}>
                      Khẩn cấp: <b style={{ color: "#1a1a1a" }}>{item.urgency}/10</b>
                    </span>
                    <span style={{ color: "#777" }}>
                      Điểm: <b style={{ color: quadrant.color }}>{item.score}</b>
                    </span>
                  </div>
                  <ScoreBar score={item.score} max={maxScore} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Visual (minimal) view */}
      {view === "visual" && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
          gap: 10,
        }}>
          {items.map((item, index) => {
            const quadrant = QUADRANTS[item.quadrant];
            return (
              <div
                key={`${item.name}-${index}`}
                style={{
                  aspectRatio: "1",
                  borderRadius: 16,
                  background: quadrant.bg,
                  border: `1.5px solid ${quadrant.border}44`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  position: "relative",
                  cursor: "default",
                }}
              >
                <div style={{ fontSize: 36 }}>{item.emoji}</div>
                <div style={{
                  position: "absolute", top: 7, right: 9,
                  fontSize: 10, fontWeight: 800, color: quadrant.color, opacity: 0.7,
                }}>
                  {index + 1}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Matrix View */}
      {view === "matrix" && (
        <div style={{ background: "white", border: "1.5px solid #e8e8e6", borderRadius: 14, padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 11, color: "#bbb" }}>
            <span />
            <span style={{ fontWeight: 600, color: "#777" }}>↑ Quan trọng</span>
            <span />
          </div>
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 10, right: 40, bottom: 40, left: 10 }}>
              {QUADRANT_AREAS.map(({ key, x1, x2, y1, y2, fill }) => (
                <ReferenceArea
                  key={key} x1={x1} x2={x2} y1={y1} y2={y2}
                  fill={fill} fillOpacity={0.9}
                  label={{
                    value: QUADRANTS[key].label,
                    position: x1 === QUADRANT_MIDPOINT
                      ? (y1 === QUADRANT_MIDPOINT ? "insideTopRight" : "insideBottomRight")
                      : (y1 === QUADRANT_MIDPOINT ? "insideTopLeft" : "insideBottomLeft"),
                    style: { fontSize: 11, fontWeight: 700, fill: QUADRANTS[key].color, opacity: 0.55 },
                  }}
                />
              ))}
              <ReferenceLine x={QUADRANT_MIDPOINT} stroke="#ddd" strokeDasharray="5 4" />
              <ReferenceLine y={QUADRANT_MIDPOINT} stroke="#ddd" strokeDasharray="5 4" />
              <XAxis
                type="number" dataKey="x" domain={[0, 10]}
                tick={{ fontSize: 11, fill: "#aaa" }} tickCount={6}
                label={{ value: "Khẩn cấp →", position: "insideBottom", offset: -20, style: { fontSize: 11, fill: "#999" } }}
              />
              <YAxis
                type="number" dataKey="y" domain={[0, 10]}
                tick={{ fontSize: 11, fill: "#aaa" }} tickCount={6}
                label={{ value: "Quan trọng", angle: -90, position: "insideLeft", offset: 20, style: { fontSize: 11, fill: "#999" } }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Scatter data={items} shape={<CustomDot />} />
            </ScatterChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "#bbb", textAlign: "center", marginTop: 4 }}>
            Di chuột vào từng item để xem chi tiết
          </div>
        </div>
      )}

      {/* Footer action */}
      <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "center" }}>
        <button
          onClick={handleReset}
          style={{
            padding: "9px 18px", fontSize: 13, fontWeight: 600,
            border: "1.5px solid #e0e0de", borderRadius: 8,
            background: "white", color: "#555", cursor: "pointer",
          }}
        >
          ← Phân tích lại
        </button>
      </div>
    </div>
  );
}
