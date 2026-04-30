export const QUADRANT_MIDPOINT = 5;
export const TOP_RANK_COUNT = 3;
export const SCORE_HIGH_THRESHOLD = 0.6;
export const SCORE_MID_THRESHOLD = 0.35;

export const QUADRANTS = {
  doFirst:  { label: "Làm ngay",       color: "#c0392b", bg: "#fdf0ef", border: "#e74c3c" },
  schedule: { label: "Lên kế hoạch",   color: "#9a6200", bg: "#fdf6e3", border: "#f0a500" },
  delegate: { label: "Cân nhắc",       color: "#1a5fa8", bg: "#eef4fc", border: "#3b82f6" },
  ignore:   { label: "Bỏ qua",         color: "#5a5a58", bg: "#f4f4f2", border: "#aaa" },
};

export const QUADRANT_AREAS = [
  { key: "schedule", x1: 0, x2: 5, y1: 5, y2: 10, fill: "#fffbec" },
  { key: "doFirst",  x1: 5, x2: 10, y1: 5, y2: 10, fill: "#fff0ef" },
  { key: "ignore",   x1: 0, x2: 5, y1: 0, y2: 5,  fill: "#f8f8f6" },
  { key: "delegate", x1: 5, x2: 10, y1: 0, y2: 5,  fill: "#eef5ff" },
];

export function quadrantOf(importance, urgency) {
  if (importance >= QUADRANT_MIDPOINT && urgency >= QUADRANT_MIDPOINT) return "doFirst";
  if (importance >= QUADRANT_MIDPOINT && urgency < QUADRANT_MIDPOINT) return "schedule";
  if (importance < QUADRANT_MIDPOINT && urgency >= QUADRANT_MIDPOINT) return "delegate";
  return "ignore";
}

export function scoreItems(rawItems) {
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

export function getFunctionUrl() {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  return import.meta.env.DEV
    ? `http://localhost:5001/${projectId}/asia-southeast1/analyze`
    : `https://asia-southeast1-${projectId}.cloudfunctions.net/analyze`;
}
