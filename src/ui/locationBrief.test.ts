import { describe, expect, it } from "vitest";
import { locationDesignation } from "./locationBrief";

describe("locationDesignation", () => {
  it("is the same file number every time the same site is looked at", () => {
    expect(locationDesignation("dockside_freeport")).toBe(
      locationDesignation("dockside_freeport"),
    );
  });

  it("gives different sites different numbers", () => {
    const ids = [
      "dockside_freeport",
      "fort_bastion_motor_pool",
      "city_hall_annex",
      "harborside_armory",
      "aerodyne_campus",
    ];
    expect(new Set(ids.map(locationDesignation)).size).toBe(ids.length);
  });

  it("always reads as a file number, whatever the id looks like", () => {
    for (const id of ["", "a", "x".repeat(200), "loc-with-dashes", "ünïcodé"]) {
      expect(locationDesignation(id)).toMatch(/^LOC-\d{4}-[A-Z]$/);
    }
  });
});
