import { describe, expect, it } from "vitest";
import { dragPayloadKind } from "./dropHint";

describe("dragPayloadKind", () => {
  it("reads the kind out of each card payload the planner can be handed", () => {
    expect(
      dragPayloadKind(
        JSON.stringify({ kind: "mastermind-mission", source: "lair", missionTemplateId: "m1" }),
      ),
    ).toBe("mastermind-mission");
    expect(dragPayloadKind(JSON.stringify({ kind: "mastermind-location", locationId: "l1" }))).toBe(
      "mastermind-location",
    );
    expect(
      dragPayloadKind(
        JSON.stringify({
          kind: "mastermind-asset",
          locationId: "l1",
          slotIndex: 0,
          visibility: "hidden",
        }),
      ),
    ).toBe("mastermind-asset");
    expect(dragPayloadKind(JSON.stringify({ kind: "mastermind-minion", instanceId: "i1" }))).toBe(
      "mastermind-minion",
    );
    expect(dragPayloadKind(JSON.stringify({ kind: "mastermind-asset-card", assetId: "a1" }))).toBe(
      "mastermind-asset-card",
    );
  });

  it("treats a bare id as a minion, which is what a staged minion chip hands over", () => {
    expect(dragPayloadKind("minion-instance-7")).toBe("mastermind-minion");
  });

  it("lights nothing for an empty, malformed, or foreign payload", () => {
    expect(dragPayloadKind("")).toBeNull();
    expect(dragPayloadKind("   ")).toBeNull();
    expect(dragPayloadKind("{not json")).toBeNull();
    expect(dragPayloadKind(JSON.stringify({ kind: "something-else" }))).toBeNull();
    expect(dragPayloadKind(JSON.stringify({ missionTemplateId: "m1" }))).toBeNull();
  });
});
