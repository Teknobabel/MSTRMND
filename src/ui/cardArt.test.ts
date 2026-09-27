import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINION_CARD_ART,
  resolveAgentCompactArt,
  resolveMinionCardArt,
  resolveMinionCompactArt,
} from "./cardArt";
import type { AgentTemplate, MinionTemplate } from "../game/types";

function minion(over: Partial<MinionTemplate>): MinionTemplate {
  return {
    id: "m",
    name: "M",
    description: "",
    hireCommandPoints: 1,
    levelUpTraitOrder: [],
    ...over,
  };
}

function agent(over: Partial<AgentTemplate>): AgentTemplate {
  return { ...minion({}), id: "a", name: "A", challengeTraitIds: [], ...over };
}

describe("resolveMinionCompactArt", () => {
  it("prefers the face crop when one has been baked", () => {
    const tpl = minion({ cardArt: "/assets/full.webp", compactArt: "/assets/face.webp" });
    expect(resolveMinionCompactArt(tpl)).toBe("/assets/face.webp");
    /* The card's own banner is untouched by it — the two are different pictures. */
    expect(resolveMinionCardArt(tpl)).toBe("/assets/full.webp");
  });

  it("falls back to the full portrait when no face has been cut", () => {
    expect(resolveMinionCompactArt(minion({ cardArt: "/assets/full.webp" }))).toBe(
      "/assets/full.webp",
    );
  });

  it("falls back to the shipped placeholder when the template has no art at all", () => {
    expect(resolveMinionCompactArt(minion({}))).toBe(DEFAULT_MINION_CARD_ART);
    expect(resolveMinionCompactArt(undefined)).toBe(DEFAULT_MINION_CARD_ART);
  });
});

describe("resolveAgentCompactArt", () => {
  it("prefers the face crop, then the agent's portrait, then the minion placeholder", () => {
    expect(
      resolveAgentCompactArt(agent({ cardArt: "/assets/a.webp", compactArt: "/assets/af.webp" })),
    ).toBe("/assets/af.webp");
    expect(resolveAgentCompactArt(agent({ cardArt: "/assets/a.webp" }))).toBe("/assets/a.webp");
    expect(resolveAgentCompactArt(agent({}))).toBe(DEFAULT_MINION_CARD_ART);
    expect(resolveAgentCompactArt(undefined)).toBe(DEFAULT_MINION_CARD_ART);
  });
});
