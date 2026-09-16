import { describe, expect, it } from "vitest";
import { tooltipText } from "./tooltip";

describe("tooltipText", () => {
  it("puts the name on the first line and the description on the second", () => {
    expect(tooltipText("Heat", "Law-enforcement attention, 0 to 100.")).toBe(
      "Heat\nLaw-enforcement attention, 0 to 100.",
    );
  });

  it("gives a name with no description nothing to wrap under it", () => {
    expect(tooltipText("Infamy")).toBe("Infamy");
    expect(tooltipText("Infamy", "")).toBe("Infamy");
    expect(tooltipText("Infamy", "   ")).toBe("Infamy");
  });

  it("folds a description written across several lines onto the one line it gets", () => {
    expect(tooltipText("Intel Level", "0 — Unknown.\n1 — slots listed.\n2 — contents known.")).toBe(
      "Intel Level\n0 — Unknown. 1 — slots listed. 2 — contents known.",
    );
  });

  it("trims both halves, so a stray newline cannot open a third line", () => {
    expect(tooltipText("  Deploy  ", "  Spends 2 CP.  ")).toBe("Deploy\nSpends 2 CP.");
  });

  it("puts a note on a third line of its own", () => {
    expect(
      tooltipText(
        "Skill - Primary",
        "A core skill. It covers this requirement on any mission that asks for it.",
        "You have 3 minions with this skill",
      ),
    ).toBe(
      "Skill - Primary\nA core skill. It covers this requirement on any mission that asks for it.\nYou have 3 minions with this skill",
    );
  });

  it("keeps the note on the third line when the description is several sentences", () => {
    // The description folds to one line, so the note is always the last of exactly three.
    expect(tooltipText("Heat", "One.\nTwo.\nThree.", "You are at tier 2").split("\n")).toEqual([
      "Heat",
      "One. Two. Three.",
      "You are at tier 2",
    ]);
  });

  it("does not leave a hole when a note arrives without a description", () => {
    expect(tooltipText("Skill - Primary", undefined, "You have 3 minions with this skill")).toBe(
      "Skill - Primary\nYou have 3 minions with this skill",
    );
  });
});
