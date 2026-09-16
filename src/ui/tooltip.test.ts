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
});
