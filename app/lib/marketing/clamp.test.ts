import { describe, it, expect } from "vitest";
import { clamp, clampList } from "./clamp";

// These were tested through decide.test.ts, where they were defined. They have
// their own file now for the reason they have their own module: copy.ts and
// brand.ts use them, both are reachable from client components, and the import
// that used to carry them also carried the planner — and through it llm.ts and
// firebase-admin. That build failure is the reason this file exists.

describe("clamp", () => {
  it("trims and caps a string", () => {
    expect(clamp("  hello  ", 10)).toBe("hello");
    expect(clamp("abcdefghij", 4)).toBe("abcd");
  });

  it("trims before capping, so leading space does not eat the budget", () => {
    expect(clamp("   abcd", 4)).toBe("abcd");
  });

  it("gives an empty string for anything that is not one", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(clamp(value, 10), String(value)).toBe("");
    }
  });
});

describe("clampList", () => {
  it("caps both axes", () => {
    expect(clampList(["abcdef", "ghijkl", "mnopqr"], 2, 3)).toEqual(["abc", "ghi"]);
  });

  it("absorbs a bare string as one item", () => {
    // A model returning a string where an array was asked for is a common
    // enough slip that one beat beats none.
    expect(clampList("just one", 5, 20)).toEqual(["just one"]);
  });

  it("drops entries that clamp to nothing", () => {
    expect(clampList(["a", "", "   ", null, "b"], 5, 10)).toEqual(["a", "b"]);
  });

  it("gives an empty list for anything else", () => {
    for (const value of [null, undefined, 42, {}, true]) {
      expect(clampList(value, 5, 10), String(value)).toEqual([]);
    }
  });
});
