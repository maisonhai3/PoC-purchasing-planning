import { describe, it, expect, vi } from "vitest";
import { quadrantOf, scoreItems, getFunctionUrl } from "./utils";

describe("quadrantOf", () => {
  it("returns doFirst when both high", () => {
    expect(quadrantOf(8, 7)).toBe("doFirst");
  });

  it("returns schedule when important but not urgent", () => {
    expect(quadrantOf(8, 3)).toBe("schedule");
  });

  it("returns delegate when urgent but not important", () => {
    expect(quadrantOf(3, 8)).toBe("delegate");
  });

  it("returns ignore when both low", () => {
    expect(quadrantOf(3, 3)).toBe("ignore");
  });

  it("treats exactly 5 as high boundary for both axes", () => {
    expect(quadrantOf(5, 5)).toBe("doFirst");
    expect(quadrantOf(5, 4)).toBe("schedule");
    expect(quadrantOf(4, 5)).toBe("delegate");
    expect(quadrantOf(4, 4)).toBe("ignore");
  });

  it("handles extremes (1 and 10)", () => {
    expect(quadrantOf(10, 10)).toBe("doFirst");
    expect(quadrantOf(1, 1)).toBe("ignore");
    expect(quadrantOf(10, 1)).toBe("schedule");
    expect(quadrantOf(1, 10)).toBe("delegate");
  });
});

describe("scoreItems", () => {
  const item = (name, importance, urgency) => ({ name, importance, urgency, emoji: "📦", reason: "" });

  it("computes score as importance × urgency", () => {
    const [result] = scoreItems([item("A", 8, 7)]);
    expect(result.score).toBe(56);
  });

  it("sorts items descending by score", () => {
    const result = scoreItems([
      item("Low",  3, 3),
      item("High", 9, 8),
      item("Mid",  6, 5),
    ]);
    expect(result.map(i => i.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("assigns correct quadrant", () => {
    const result = scoreItems([item("A", 8, 7)]);
    expect(result[0].quadrant).toBe("doFirst");
  });

  it("maps urgency → x and importance → y for scatter chart", () => {
    const [result] = scoreItems([item("A", 8, 7)]);
    expect(result.x).toBe(7);
    expect(result.y).toBe(8);
  });

  it("preserves all original fields", () => {
    const [result] = scoreItems([{ name: "Test", importance: 8, urgency: 7, emoji: "🎯", reason: "testing" }]);
    expect(result.name).toBe("Test");
    expect(result.emoji).toBe("🎯");
    expect(result.reason).toBe("testing");
  });

  it("handles a single item without error", () => {
    const result = scoreItems([item("Solo", 5, 5)]);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(25);
  });

  it("returns empty array for empty input", () => {
    expect(scoreItems([])).toEqual([]);
  });
});

describe("getFunctionUrl", () => {
  // Vitest runs with import.meta.env.DEV = true, so we get the local emulator URL
  it("returns localhost emulator URL (Vitest runs in dev mode)", () => {
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "my-project");
    const url = getFunctionUrl();
    expect(url).toBe("http://localhost:5001/my-project/asia-southeast1/analyze");
    vi.unstubAllEnvs();
  });

  it("always includes the project ID", () => {
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "abc-123");
    expect(getFunctionUrl()).toContain("abc-123");
    vi.unstubAllEnvs();
  });

  it("always ends with /analyze", () => {
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "any-project");
    expect(getFunctionUrl()).toMatch(/\/analyze$/);
    vi.unstubAllEnvs();
  });
});
