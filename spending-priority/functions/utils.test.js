const { sanitizeInput, computeCacheKey, buildPrompt, buildScoringTool, MAX_ITEMS, MAX_ITEM_LENGTH } = require("./utils");

describe("sanitizeInput", () => {
  it("trims whitespace from each line", () => {
    expect(sanitizeInput(["  foo  ", "  bar  "])).toEqual(["foo", "bar"]);
  });

  it("filters out blank lines", () => {
    expect(sanitizeInput(["foo", "", "   ", "bar"])).toEqual(["foo", "bar"]);
  });

  it("limits to MAX_ITEMS items", () => {
    const manyItems = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    expect(sanitizeInput(manyItems)).toHaveLength(MAX_ITEMS);
  });

  it("truncates each item to MAX_ITEM_LENGTH characters", () => {
    const longItem = "a".repeat(MAX_ITEM_LENGTH + 50);
    const result = sanitizeInput([longItem]);
    expect(result[0]).toHaveLength(MAX_ITEM_LENGTH);
  });

  it("handles null input gracefully", () => {
    expect(sanitizeInput(null)).toEqual([]);
  });

  it("handles undefined input gracefully", () => {
    expect(sanitizeInput(undefined)).toEqual([]);
  });

  it("coerces non-string values to strings", () => {
    expect(sanitizeInput([42, true])).toEqual(["42", "true"]);
  });
});

describe("computeCacheKey", () => {
  it("returns a 64-character hex string", () => {
    expect(computeCacheKey(["a", "b"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const key1 = computeCacheKey(["apple", "banana"]);
    const key2 = computeCacheKey(["apple", "banana"]);
    expect(key1).toBe(key2);
  });

  it("is order-independent", () => {
    const key1 = computeCacheKey(["apple", "banana"]);
    const key2 = computeCacheKey(["banana", "apple"]);
    expect(key1).toBe(key2);
  });

  it("produces different keys for different inputs", () => {
    const key1 = computeCacheKey(["apple"]);
    const key2 = computeCacheKey(["orange"]);
    expect(key1).not.toBe(key2);
  });

  it("does not mutate the input array", () => {
    const lines = ["b", "a"];
    computeCacheKey(lines);
    expect(lines).toEqual(["b", "a"]);
  });
});

describe("buildPrompt", () => {
  it("numbers all items sequentially", () => {
    const prompt = buildPrompt(["Rent", "Food", "Gym"]);
    expect(prompt).toContain("1. Rent");
    expect(prompt).toContain("2. Food");
    expect(prompt).toContain("3. Gym");
  });

  it("mentions importance and urgency scoring criteria", () => {
    const prompt = buildPrompt(["item"]);
    expect(prompt).toContain("importance");
    expect(prompt).toContain("urgency");
  });
});

describe("buildScoringTool", () => {
  it("declares exactly one function named score_items", () => {
    const tool = buildScoringTool();
    expect(tool.functionDeclarations).toHaveLength(1);
    expect(tool.functionDeclarations[0].name).toBe("score_items");
  });

  it("requires the items field at the top level", () => {
    const tool = buildScoringTool();
    expect(tool.functionDeclarations[0].parameters.required).toContain("items");
  });

  it("requires all five item-level fields", () => {
    const tool = buildScoringTool();
    const itemSchema = tool.functionDeclarations[0].parameters.properties.items.items;
    expect(itemSchema.required).toEqual(
      expect.arrayContaining(["name", "emoji", "importance", "urgency", "reason"]),
    );
  });

  it("types importance and urgency as NUMBER", () => {
    const tool = buildScoringTool();
    const props = tool.functionDeclarations[0].parameters.properties.items.items.properties;
    expect(props.importance.type).toBe("NUMBER");
    expect(props.urgency.type).toBe("NUMBER");
  });
});
