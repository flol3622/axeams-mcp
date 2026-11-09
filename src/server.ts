#!/usr/bin/env bun
// MCP server exposing Microsoft Teams for Mac (chats, teams, channels, threads, shared files), read-only,
// by driving its UI through Accessibility.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ax, exclusive, status, TeamsError, windows } from "./teams/session";
import * as chat from "./teams/chat";
import * as channels from "./teams/channels";
import { conventionsInstructions, MAX_CHARS, readConventions, writeConventions } from "./conventions";
import pkg from "../package.json";

/** The user's conventions, read once at startup; a broken file must never stop the server. */
function safeInstructions(): string {
  try {
    return conventionsInstructions(readConventions());
  } catch (e) {
    return `The user's conventions file could not be read (${e instanceof Error ? e.message : e}); call teams_get_conventions for details.`;
  }
}

const server = new McpServer(
  { name: "axeams", version: pkg.version },
  {
    instructions: [
      "Reads the user's running Microsoft Teams for Mac (chats, teams, channels, threads, shared files) through macOS Accessibility. Read-only: it never posts, replies or reacts.",
      "Use these tools for every question about the user's Teams chats or channels, even when Teams is not named, unless the user explicitly names another source.",
      "Workflow: teams_list_chats → teams_read_chat; teams_list_teams → teams_list_channels → teams_read_channel → teams_read_thread for a post's full replies.",
      "Names are matched case-insensitively: exact, then prefix, then substring.",
      "Only what Teams has loaded is visible: pass `older` to scroll back for older history.",
      "Opening a chat or channel marks it read in Teams, as it would for the user.",
      "Files: teams_list_files lists a channel's Shared tab (names only). Where to read file contents is up to the user's conventions.",
      "Calls are serialized and take seconds (it is UI automation). Teams' visible chat or channel changes as tools navigate.",
      "",
      safeInstructions(),
    ].join("\n"),
  },
);

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(e: unknown) {
  const msg = e instanceof TeamsError ? e.message : e instanceof Error ? `Unexpected error: ${e.message}` : String(e);
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

/** Wrap a handler: serialize UI access and convert errors into tool errors. */
function run<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await exclusive(() => fn(args)));
    } catch (e) {
      return fail(e);
    }
  };
}

const RO = { readOnlyHint: true, openWorldHint: false } as const;
const team = z.string().min(1).describe("Team name as returned by teams_list_teams (case-insensitive; a unique prefix or substring works)");
const channel = z.string().min(1).describe("Channel name as returned by teams_list_channels");
const limit = (d: number) => z.number().int().min(1).max(500).default(d).describe("Return at most this many of the most recent items");
const older = z.number().int().min(0).max(20).default(0).describe("Scroll back this many times to load older history first (each adds roughly 10-20 items)");

// ------------------------------------------------------------------------------------------------
// Diagnostics

server.registerTool(
  "teams_status",
  {
    description: "Check that Teams is running, Accessibility permission is granted, and what Teams currently shows.",
    inputSchema: {},
    annotations: RO,
  },
  run(async () => {
    const st = await status();
    const front = await ax.call("frontmost");
    return {
      ...st,
      screenLocked: front?.bundleId === "com.apple.loginwindow",
      windows: st.trusted && st.running ? (await windows()).map((w) => ({ title: w.title, main: !!w.main })) : [],
    };
  }),
);

server.registerTool(
  "teams_ui_snapshot",
  {
    description: "Debug aid: dump part of Teams' accessibility tree (roles, labels). Use only when another tool fails because Teams' UI changed.",
    inputSchema: {
      depth: z.number().int().min(1).max(40).default(6),
      match: z.string().optional().describe("Only dump subtrees whose label/value contains this text"),
    },
    annotations: RO,
  },
  run(async ({ depth, match }: { depth: number; match?: string }) => {
    if (match) return ax.find("main", { anyContains: match }, { depth: 60, limit: 10, subtree: depth });
    return ax.tree("main", depth, { maxChildren: 60 });
  }),
);

// ------------------------------------------------------------------------------------------------
// Chat

server.registerTool(
  "teams_list_chats",
  {
    description: "List the chats in Teams' Chat list (1:1, group and meeting chats) with section, unread flag, last activity and preview.",
    inputSchema: {},
    annotations: RO,
  },
  run(async () => chat.listChats()),
);

server.registerTool(
  "teams_read_chat",
  {
    description: "Open a chat and return its messages, oldest first: author, time, text, attachments, reactions. Marks the chat read in Teams.",
    inputSchema: {
      chat: z.string().min(1).describe("Chat name as returned by teams_list_chats (person, group or meeting name)"),
      limit: limit(50),
      older,
    },
    annotations: RO,
  },
  run(async (a: { chat: string; limit: number; older: number }) => chat.readChat(a.chat, { limit: a.limit, older: a.older })),
);

// ------------------------------------------------------------------------------------------------
// Teams and channels

server.registerTool(
  "teams_list_teams",
  {
    description: "List the teams the user belongs to.",
    inputSchema: {},
    annotations: RO,
  },
  run(async () => ({ teams: await channels.listTeams() })),
);

server.registerTool(
  "teams_list_channels",
  {
    description: "List a team's channels, grouped by section.",
    inputSchema: { team },
    annotations: RO,
  },
  run(async (a: { team: string }) => channels.listChannels(a.team)),
);

server.registerTool(
  "teams_read_channel",
  {
    description:
      "Read a channel's posts, oldest first. Each post has author, time, optional subject, text, attachments, reactions, the reply count and the replies Teams shows inline (usually the last few; use teams_read_thread for all).",
    inputSchema: { team, channel, limit: limit(20), older },
    annotations: RO,
  },
  run(async (a: { team: string; channel: string; limit: number; older: number }) => channels.readChannel(a.team, a.channel, { limit: a.limit, older: a.older })),
);

server.registerTool(
  "teams_read_thread",
  {
    description: "Open one channel post and return the whole conversation: the post followed by every reply.",
    inputSchema: {
      team,
      channel,
      post: z.string().min(1).describe("Words from the post's subject or text (or its author) as returned by teams_read_channel; the first loaded post that contains them is opened"),
      older,
    },
    annotations: RO,
  },
  run(async (a: { team: string; channel: string; post: string; older: number }) => channels.readThread(a.team, a.channel, a.post, { older: a.older })),
);

server.registerTool(
  "teams_list_files",
  {
    description:
      "List the files and folders at the top of a channel's Shared tab (its SharePoint library): name, type, modified, modified by. Does not read file contents.",
    inputSchema: { team, channel },
    annotations: RO,
  },
  run(async (a: { team: string; channel: string }) => channels.listFiles(a.team, a.channel)),
);

// ------------------------------------------------------------------------------------------------
// Personal conventions (plain file; no Teams access, so not serialized with UI calls)

server.registerTool(
  "teams_get_conventions",
  {
    description:
      "Read the user's personal Teams conventions (which teams and chats matter, where shared files can be found locally, how to summarize…). Check them before answering about files or summarizing.",
    inputSchema: {},
    annotations: RO,
  },
  async () => {
    try {
      const c = readConventions();
      return ok({ path: c.path, exists: c.exists, settings: c.settings, content: c.raw || null, maxChars: MAX_CHARS });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "teams_set_conventions",
  {
    description:
      "Save the user's personal Teams conventions (replaces the whole file; the previous version is kept as .bak). Only call after the user has approved the exact text. Markdown, optionally starting with front matter `key: value` lines (guidance only).",
    inputSchema: {
      content: z.string().min(1).max(MAX_CHARS).describe("Full Markdown file, e.g. '# Files\n- Channel files are synced under ~/…; search there.'"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async (a: { content: string }) => {
    try {
      const c = writeConventions(a.content);
      return ok({
        saved: c.changed,
        path: c.path,
        backup: c.changed ? `${c.path}.bak` : null,
        note: c.changed ? "Restart the client to refresh the conventions shown in the server instructions." : "Content identical to the current file; nothing changed.",
      });
    } catch (e) {
      return fail(e);
    }
  },
);

// ------------------------------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
process.on("SIGINT", () => {
  ax.close();
  process.exit(0);
});
process.stdin.on("close", () => {
  ax.close();
  process.exit(0);
});
