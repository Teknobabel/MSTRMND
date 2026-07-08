import { describe, expect, it } from "vitest";
import { serializeContentSlice } from "./contentSerialize";

describe("serializeContentSlice", () => {
  it("emits identical text regardless of input key order", () => {
    const a = [{ name: "Ray Gun", id: "as-gun", description: "Zap" }];
    const b = [{ description: "Zap", id: "as-gun", name: "Ray Gun" }];
    expect(serializeContentSlice(a)).toBe(serializeContentSlice(b));
  });

  it("orders preferred keys first, then the rest alphabetically", () => {
    const text = serializeContentSlice({
      zeta: 1,
      name: "N",
      alpha: 2,
      kind: "k",
      id: "x",
    });
    const keyOrder = [...text.matchAll(/"(\w+)":/g)].map((m) => m[1]);
    expect(keyOrder).toEqual(["id", "kind", "name", "alpha", "zeta"]);
  });

  it("preserves array order (content ordering is meaningful)", () => {
    const text = serializeContentSlice({ id: "m", levelUpTraitOrder: ["b", "a", "c"] });
    expect(text).toContain('[\n    "b",\n    "a",\n    "c"\n  ]');
  });

  it("uses 2-space indent and ends with a trailing newline", () => {
    const text = serializeContentSlice([{ id: "x" }]);
    expect(text).toBe('[\n  {\n    "id": "x"\n  }\n]\n');
  });

  it("drops undefined values instead of serializing them", () => {
    const text = serializeContentSlice({ id: "x", description: undefined });
    expect(text).not.toContain("description");
  });

  it("recurses into nested objects", () => {
    const text = serializeContentSlice({
      id: "ms",
      onSuccessEffects: [{ missionId: "m2", kind: "unlock_lair_mission" }],
    });
    const kindIdx = text.indexOf('"kind"');
    const missionIdIdx = text.indexOf('"missionId"');
    expect(kindIdx).toBeGreaterThan(-1);
    expect(kindIdx).toBeLessThan(missionIdIdx);
  });
});
