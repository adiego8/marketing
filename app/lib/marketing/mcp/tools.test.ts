import { describe, it, expect } from "vitest";
import { TOOLS, toolsForScopes } from "./tools";
import { API_KEY_SCOPES } from "../../types";

/**
 * Two failure modes, both silent.
 *
 * A read-only key offered report_published: the model calls it, is refused,
 * and retries — and the tool list itself has disclosed a capability the holder
 * was never granted.
 *
 * An annotation left off: the SDK defaults destructiveHint and openWorldHint
 * to TRUE, so a tool that merely forgot to mention it is presented to the host
 * as dangerous, and operators learn to click through the warning.
 */

describe("toolsForScopes", () => {
  const names = (scopes: string[]) => toolsForScopes(scopes).map((t) => t.name);

  it("offers nothing to a key with no scopes", () => {
    expect(names([])).toEqual([]);
  });

  it("offers the reads to a read-only key", () => {
    expect(names(["schedule:read", "brand:read"])).toEqual([
      "list_clients",
      "list_scheduled_content",
      "get_content",
      "get_brand",
    ]);
  });

  // The one that matters: not refused when called, never shown at all.
  it("hides the write tools from a read-only key", () => {
    const offered = names(["schedule:read", "brand:read"]);
    expect(offered).not.toContain("report_published");
    expect(offered).not.toContain("report_failed");
  });

  it("offers everything to a full key", () => {
    expect(names([...API_KEY_SCOPES])).toHaveLength(TOOLS.length);
  });

  // A key whose scopes failed to deserialize must grant nothing rather than
  // everything — the same fail-closed rule as hasScope.
  it("grants nothing on junk scopes", () => {
    expect(names(["nonsense", "*", "admin"])).toEqual([]);
  });

  it("does not leak brand tools to a schedule-only key", () => {
    expect(names(["schedule:read"])).toEqual(["list_scheduled_content", "get_content"]);
  });
});

describe("every tool", () => {
  it("declares all four annotations explicitly", () => {
    for (const tool of TOOLS) {
      for (const hint of [
        "readOnlyHint",
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
      ] as const) {
        expect(tool.annotations, `${tool.name} is missing ${hint}`).toHaveProperty(hint);
        expect(typeof tool.annotations[hint], `${tool.name}.${hint}`).toBe("boolean");
      }
    }
  });

  it("marks the reads read-only and the writes not", () => {
    const readOnly = TOOLS.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
    expect(readOnly).toEqual([
      "list_clients",
      "list_scheduled_content",
      "get_content",
      "get_brand",
    ]);
  });

  // Nothing here deletes anything. Saying otherwise trains people to dismiss
  // the warning that would matter on a tool that did.
  it("claims nothing is destructive", () => {
    expect(TOOLS.every((t) => t.annotations.destructiveHint === false)).toBe(true);
  });

  it("carries a scope this system actually issues", () => {
    for (const tool of TOOLS) {
      expect(API_KEY_SCOPES, tool.name).toContain(tool.scope);
    }
  });

  it("has a unique name", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  /**
   * The description is the only documentation a model is guaranteed to read,
   * so the rules that prevent real damage have to be in it.
   */
  it("tells the model the rules that matter", () => {
    const publish = TOOLS.find((t) => t.name === "report_published")!;
    expect(publish.description).toMatch(/ONLY call this after/);
    expect(publish.description).toMatch(/platform's own identifier/i);

    const list = TOOLS.find((t) => t.name === "list_scheduled_content")!;
    expect(list.description).toMatch(/client's timezone/i);

    const failed = TOOLS.find((t) => t.name === "report_failed")!;
    expect(failed.description).toMatch(/stays\s+scheduled/);
  });

  it("describes every input it accepts", () => {
    for (const tool of TOOLS) {
      for (const [field, schema] of Object.entries(tool.inputSchema)) {
        expect(schema.description, `${tool.name}.${field} has no description`).toBeTruthy();
      }
    }
  });
});
