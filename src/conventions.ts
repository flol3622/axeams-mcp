// Per-user conventions: a small Markdown file describing how this user works with Teams, e.g. which teams
// and chats matter, where their channel files are synced locally, how to summarize.
// It lives outside the plugin so it survives updates: $AXEAMS_CONFIG_DIR or ~/.config/axeams.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Conventions {
  path: string;
  exists: boolean;
  /** Front-matter `key: value` lines: guidance for Claude only, never applied by the server. */
  settings: Record<string, string>;
  /** Markdown after the front matter. */
  body: string;
  /** The whole file as stored. */
  raw: string;
}

/** Longest conventions file accepted, to keep tool instructions small. */
export const MAX_CHARS = 8000;

export function conventionsPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.AXEAMS_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "axeams");
  return join(dir, "conventions.md");
}

/** Split `---\nkey: value\n---\nbody` into front matter and body. Unknown or malformed lines are ignored. */
export function parseConventions(raw: string): { settings: Record<string, string>; body: string } {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { settings: {}, body: text.trim() };
  const settings: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/);
    if (!kv || line.trimStart().startsWith("#")) continue;
    let value = kv[2]!;
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (value) settings[kv[1]!.toLowerCase()] = value;
  }
  return { settings, body: text.slice(m[0].length).trim() };
}

export function readConventions(path = conventionsPath()): Conventions {
  if (!existsSync(path)) return { path, exists: false, settings: {}, body: "", raw: "" };
  const raw = readFileSync(path, "utf8");
  return { path, exists: true, raw, ...parseConventions(raw) };
}

/**
 * Save the conventions file. The previous version is copied to conventions.md.bak; saving identical
 * content changes nothing (so a repeated save cannot wipe the backup). The write is atomic.
 */
export function writeConventions(content: string, path = conventionsPath()): Conventions & { changed: boolean } {
  const text = content.replace(/\r\n/g, "\n").trim() + "\n";
  if (text.length > MAX_CHARS) {
    throw new Error(`Conventions are limited to ${MAX_CHARS} characters (got ${text.length}); keep them to the rules that matter.`);
  }
  mkdirSync(join(path, ".."), { recursive: true });
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === text) return { ...readConventions(path), changed: false };
    copyFileSync(path, `${path}.bak`);
  }
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
  return { ...readConventions(path), changed: true };
}

/** Text appended to the MCP server instructions so every client sees the user's conventions. */
export function conventionsInstructions(c: Conventions): string {
  if (!c.exists || (!c.body && !Object.keys(c.settings).length)) {
    return "No personal conventions are set. If the user states a lasting preference (e.g. where their channel files are synced, which teams matter), offer to save it with teams_set_conventions.";
  }
  const settings = Object.entries(c.settings).map(([k, v]) => `${k}: ${v}`).join("; ");
  return [
    "The user's personal conventions (follow them unless the user asks otherwise; teams_get_conventions returns the current version):",
    settings ? `Settings: ${settings}.` : "",
    c.body.slice(0, MAX_CHARS),
  ].filter(Boolean).join("\n");
}
