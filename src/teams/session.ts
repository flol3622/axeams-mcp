// Shared Teams UI session: one Accessibility helper, one queue (the UI is a single shared resource),
// main-window discovery and app (Chat / Teams) switching.
import { execFile } from "node:child_process";
import { AxClient, type AxNode, type Match } from "../ax";

export class TeamsError extends Error {}

export const ax = new AxClient();

let queue: Promise<unknown> = Promise.resolve();

/** Run UI work strictly one call at a time. Handles from previous calls are released first. */
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    await ax.call("release").catch(() => {});
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run macOS `open` with the given arguments. */
export function openApp(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => execFile("/usr/bin/open", args, (err) => (err ? reject(err) : resolve())));
}

/** Poll `fn` until it returns a truthy value or the timeout elapses. */
export async function until<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 5000, everyMs = 150): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    if (Date.now() >= deadline) return null;
    await sleep(everyMs);
  }
}

export interface Status {
  trusted: boolean;
  running: boolean;
  version: string | null;
  pid: number;
}

export async function status(): Promise<Status> {
  return ax.call<Status>("ping");
}

export async function windows(): Promise<AxNode[]> {
  return ax.call<AxNode[]>("windows");
}

/** The main Teams window. Starts Teams in the background if needed. */
export async function mainWindow(): Promise<AxNode> {
  const st = await status();
  if (!st.trusted) {
    throw new TeamsError(
      "Accessibility permission missing. Grant it in System Settings > Privacy & Security > Accessibility to the app that launches this MCP server (e.g. Claude, Terminal, iTerm, VS Code), then restart it.",
    );
  }
  if (!st.running) {
    await openApp(["-g", "-b", "com.microsoft.teams2"]).catch(() => {});
    const ok = await until(async () => (await status()).running, 45_000, 500);
    if (!ok) throw new TeamsError("Microsoft Teams is not running and could not be started.");
  }
  const find = async () => {
    const ws = (await windows()).filter((w) => w.role === "AXWindow" && w.subrole === "AXStandardWindow");
    return ws.find((w) => w.main) ?? ws[0] ?? null;
  };
  let w = await until(find, 15_000, 500);
  if (w) return w;
  if ((await ax.call<{ bundleId?: string }>("frontmost")).bundleId === "com.apple.loginwindow") {
    throw new TeamsError("The Mac's screen is locked; macOS hides app windows from Accessibility until it is unlocked.");
  }
  const prev = await ax.call("frontmost");
  await openApp(["-b", "com.microsoft.teams2"]).catch(() => {});
  w = await until(find, 8000, 250);
  if (prev?.pid) await ax.call("restore", { pid: prev.pid }).catch(() => {});
  if (!w) throw new TeamsError("Could not find Teams' main window.");
  return w;
}

/** The main window title, e.g. "Chat | <chat> | <org> | <account>" or "Teams and Channels | <team> | <channel> | …". */
export async function mainTitle(): Promise<string> {
  return (await ax.get("main")).title ?? "";
}

export type App = "Chat" | "Teams";

/** Switch Teams to the Chat or Teams app through the left rail (works in the background). */
export async function switchApp(app: App): Promise<void> {
  await mainWindow();
  const prefix = app === "Chat" ? "Chat |" : "Teams and Channels";
  if ((await mainTitle()).startsWith(prefix)) return;
  const btn = await need("main", { role: "AXCheckBox", title: app }, `the ${app} button in the left rail`, { depth: 30 });
  await ax.press(btn.h);
  if (!(await until(async () => (await mainTitle()).startsWith(prefix), 8000))) throw new TeamsError(`Teams did not switch to ${app}.`);
}

/** Find a single element or throw a descriptive error. */
export async function need(h: string, match: Match, what: string, opts: { depth?: number; timeoutMs?: number } = {}): Promise<AxNode> {
  if (opts.timeoutMs) {
    const r = await ax.waitFor(h, match, { timeoutMs: opts.timeoutMs, depth: opts.depth });
    if (r.ok && r.node) return r.node;
  } else {
    const n = await ax.findOne(h, match, { depth: opts.depth });
    if (n) return n;
  }
  throw new TeamsError(`Could not find ${what} in Teams' UI.`);
}

/** Pick the best match for a user-given name: exact (case-insensitive), then prefix, then substring. */
export function pick<T>(items: T[], name: string, key: (t: T) => string, what: string): T {
  const q = name.trim().toLowerCase();
  const by = (f: (s: string) => boolean) => items.filter((t) => f(key(t).toLowerCase()));
  for (const hits of [by((s) => s === q), by((s) => s.startsWith(q)), by((s) => s.includes(q))]) {
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) throw new TeamsError(`'${name}' matches several ${what}s: ${hits.slice(0, 8).map(key).join(" | ")}. Be more specific.`);
  }
  const known = items.map(key).slice(0, 30).join(" | ");
  throw new TeamsError(`No ${what} matches '${name}'.${known ? ` Visible: ${known}` : ""}`);
}
