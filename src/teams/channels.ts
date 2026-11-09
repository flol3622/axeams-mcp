// Teams app: list teams and channels, read channel posts and threads, list a channel's shared files.
import type { AxNode } from "../ax";
import { loadOlder, mergeOlder } from "./chat";
import { findAll, findFirst, parseChannelList, parseChannelPosts, parseFiles, parseTeamList, parseThread, type FileRow, type Message, type Post } from "./parse";
import { ax, mainTitle, need, pick, switchApp, TeamsError, until } from "./session";

const DEEP = 60;

/** Leave an open reply thread (the thread view replaces the channel). */
async function closeThread() {
  const back = await ax.findOne("main", { role: "AXButton", title: "Go to channel" }, { depth: DEEP });
  if (!back) return;
  await ax.press(back.h);
  await until(async () => !(await ax.findOne("main", { role: "AXButton", title: "Go to channel" }, { depth: DEEP })), 5000);
}

/** Window title parts while inside a team: ["Teams and Channels", team, channel, org, account]. */
async function location(): Promise<{ team: string | null; channel: string | null }> {
  const inside = await ax.findOne("main", { role: "AXButton", title: "Back to All teams" }, { depth: DEEP });
  if (!inside) return { team: null, channel: null };
  const parts = (await mainTitle()).split(" | ");
  return { team: parts[1] ?? null, channel: parts[2] ?? null };
}

async function teamGroups(): Promise<AxNode[]> {
  return ax.find("main", { subrole: "AXApplicationGroup", titleRegex: " Team \\d+ of \\d+$" }, { depth: DEEP, limit: 500, subtree: 3 });
}

async function showAllTeams(): Promise<AxNode[]> {
  await switchApp("Teams");
  await closeThread();
  const back = await ax.findOne("main", { role: "AXButton", title: "Back to All teams" }, { depth: DEEP });
  if (back) await ax.press(back.h);
  const groups = await until(async () => {
    const g = await teamGroups();
    return g.length ? g : null;
  }, 8000, 300);
  if (!groups) throw new TeamsError("Could not find the list of teams in Teams' UI.");
  return groups;
}

export async function listTeams(): Promise<string[]> {
  return parseTeamList({ h: "", children: await showAllTeams() });
}

async function openTeam(team: string): Promise<string> {
  await switchApp("Teams");
  await closeThread();
  const here = await location();
  if (here.team && here.team.toLowerCase() === team.trim().toLowerCase()) return here.team;
  const groups = await showAllTeams();
  const names = parseTeamList({ h: "", children: groups });
  const name = pick(names, team, (n) => n, "team");
  const g = groups[names.indexOf(name)]!;
  const btn = findFirst(g, (n) => n.role === "AXButton" && n.title === name);
  if (!btn) throw new TeamsError(`Could not find the button for team '${name}'.`);
  await ax.press(btn.h);
  if (!(await until(async () => (await location()).team === name, 8000, 300))) throw new TeamsError(`Teams did not open the team '${name}'.`);
  return name;
}

async function channelOutline(): Promise<AxNode> {
  const outline = await until(async () => {
    const [o] = await ax.find("main", { role: "AXOutline" }, { depth: DEEP, limit: 1, subtree: 8, maxChildren: 300, extra: ["AXDisclosureLevel"] });
    return o && parseChannelList(o).length ? o : null;
  }, 8000, 300);
  if (!outline) throw new TeamsError("Could not find the team's channel list in Teams' UI.");
  return outline;
}

export async function listChannels(team: string): Promise<{ team: string; channels: { name: string; section: string | null }[]; note: string }> {
  const name = await openTeam(team);
  return { team: name, channels: parseChannelList(await channelOutline()), note: "Channels under a collapsed section (e.g. Hidden channels) are not listed." };
}

type Tab = "Posts" | "Shared";

async function openChannel(team: string, channel: string, tab: Tab): Promise<{ team: string; channel: string }> {
  const teamName = await openTeam(team);
  let here = await location();
  let name = here.channel ?? "";
  if (name.toLowerCase() !== channel.trim().toLowerCase()) {
    const outline = await channelOutline();
    const rows = findAll(outline, (n) => n.role === "AXRow" && Number(n.x?.AXDisclosureLevel ?? 1) > 0);
    const row = pick(rows, channel, (r) => r.title ?? "", "channel");
    name = row.title!;
    await ax.press(row.h);
    if (!(await until(async () => (await location()).channel === name, 8000, 300))) throw new TeamsError(`Teams did not open the channel '${name}'.`);
  }
  const t = await need("main", { role: "AXRadioButton", title: tab }, `the ${tab} tab`, { depth: DEEP, timeoutMs: 5000 });
  if (!t.selected) {
    await ax.press(t.h);
    await until(async () => (await ax.findOne("main", { role: "AXRadioButton", title: tab }, { depth: DEEP }))?.selected, 5000);
  }
  return { team: teamName, channel: name };
}

async function postsTree(): Promise<AxNode> {
  const [posts] = await ax.find("main", { role: "AXGroup", title: "Posts" }, { depth: DEEP, limit: 1, subtree: 45, maxChildren: 1000, extra: ["AXURL"] });
  if (!posts) throw new TeamsError("Could not find the channel's posts in Teams' UI.");
  return posts;
}

async function waitForPosts(): Promise<AxNode> {
  const g = await need("main", { role: "AXGroup", title: "Posts" }, "the channel's posts", { depth: DEEP, timeoutMs: 8000 });
  // Either posts with timestamps or the empty-channel placeholder.
  await until(async () => (await ax.findOne(g.h, { subrole: "AXTimeGroup" }, { depth: DEEP })) ?? (await ax.findOne(g.h, { role: "AXButton", title: "Post in channel" }, { depth: 8 })), 6000, 300);
  return g;
}

export async function readChannel(team: string, channel: string, opts: { limit: number; older: number }): Promise<{ team: string; channel: string; posts: Post[]; truncated: boolean }> {
  const where = await openChannel(team, channel, "Posts");
  let g = await waitForPosts();
  let posts = parseChannelPosts(await postsTree());
  for (let i = 0; i < opts.older; i++) {
    if (!(await loadOlder(g.h))) break;
    posts = mergeOlder(posts, parseChannelPosts(await postsTree()));
    g = await waitForPosts();
  }
  return { ...where, posts: posts.slice(-opts.limit), truncated: posts.length > opts.limit };
}

const matches = (m: Message, q: string) => [m.subject, m.text, m.author].some((s) => s?.toLowerCase().includes(q));

export async function readThread(team: string, channel: string, post: string, opts: { older: number }): Promise<{ team: string; channel: string; messages: Message[] }> {
  const where = await openChannel(team, channel, "Posts");
  await waitForPosts();
  const q = post.trim().toLowerCase();
  const tree = await postsTree();
  // Thread wrappers are the outermost message groups; the first whose root post matches wins.
  const wrappers = findAll(tree, (n) => n.subrole === "AXApplicationGroup" && !!findFirst(n, (x) => x.role === "AXButton" && x.title === "Reply"));
  const hit = wrappers.find((w) => {
    const root = parseChannelPosts({ h: "", children: [w] })[0];
    return root && matches(root, q);
  });
  if (!hit) throw new TeamsError(`No loaded post in '${where.channel}' matches '${post}'. Use teams_read_channel (with older) to find it, then pass words from its subject or text.`);
  const open = findFirst(hit, (n) => n.role === "AXButton" && /^Open \d+ repl/.test(n.title ?? ""));
  if (!open) {
    const p = parseChannelPosts({ h: "", children: [hit] })[0]!;
    return { ...where, messages: [{ ...p, replies: undefined, replyCount: undefined } as Message, ...p.replies] };
  }
  await ax.press(open.h);
  await need("main", { role: "AXButton", title: "Go to channel" }, "the opened thread", { depth: DEEP, timeoutMs: 8000 });
  await until(async () => (await ax.findOne("main", { subrole: "AXTimeGroup" }, { depth: DEEP })) ?? false, 6000, 300);
  const read = async () => parseThread(await ax.tree("main", DEEP, { maxChildren: 1000, extra: ["AXURL"] }));
  try {
    let messages = await read();
    for (let i = 0; i < opts.older; i++) {
      if (!(await loadOlder("main"))) break;
      messages = mergeOlder(messages, await read());
    }
    return { ...where, messages };
  } finally {
    await closeThread();
  }
}

export async function listFiles(team: string, channel: string): Promise<{ team: string; channel: string; folder: string | null; files: FileRow[]; note?: string }> {
  const where = await openChannel(team, channel, "Shared");
  const found = await until(async () => {
    const [t] = await ax.find("main", { role: "AXTable" }, { depth: DEEP + 20, limit: 1, subtree: 6, maxChildren: 2000 });
    return t && (t.children ?? []).length > 1 ? t : null;
  }, 12_000, 500);
  if (!found) {
    return { ...where, folder: null, files: [], note: "The Shared tab did not show a file table (empty library, still loading, or a different layout)." };
  }
  return { ...where, folder: found.title ?? null, files: parseFiles(found), note: "Only the rows Teams has rendered are listed; file contents are not read." };
}
