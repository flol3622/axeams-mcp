import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conventionsInstructions, conventionsPath, MAX_CHARS, parseConventions, readConventions, writeConventions } from "../src/conventions";

describe("conventions", () => {
  test("path: AXEAMS_CONFIG_DIR, then XDG_CONFIG_HOME, then ~/.config", () => {
    expect(conventionsPath({ AXEAMS_CONFIG_DIR: "/tmp/ax", XDG_CONFIG_HOME: "/x" })).toBe("/tmp/ax/conventions.md");
    expect(conventionsPath({ XDG_CONFIG_HOME: "/x" })).toBe("/x/axeams/conventions.md");
    expect(conventionsPath({})).toMatch(/\/\.config\/axeams\/conventions\.md$/);
  });

  test("front matter settings and body", () => {
    expect(parseConventions('---\nlanguage: "en"\n# comment\n---\n# Files\n- x\n')).toEqual({ settings: { language: "en" }, body: "# Files\n- x" });
    expect(parseConventions("# Just rules")).toEqual({ settings: {}, body: "# Just rules" });
  });

  test("write keeps a backup, identical content changes nothing, size is capped", () => {
    const path = join(mkdtempSync(join(tmpdir(), "axeams-conv-")), "conventions.md");
    expect(readConventions(path).exists).toBe(false);
    expect(writeConventions("# A", path).changed).toBe(true);
    expect(writeConventions("# B", path).changed).toBe(true);
    expect(readFileSync(`${path}.bak`, "utf8")).toBe("# A\n");
    expect(writeConventions("# B", path).changed).toBe(false);
    expect(() => writeConventions("x".repeat(MAX_CHARS + 1), path)).toThrow();
  });

  test("instructions", () => {
    expect(conventionsInstructions(readConventions("/nonexistent/c.md"))).toContain("teams_set_conventions");
    const c = { path: "p", exists: true, settings: { language: "en" }, body: "# Files\n- look in ~/Sync", raw: "" };
    expect(conventionsInstructions(c)).toContain("look in ~/Sync");
  });
});
