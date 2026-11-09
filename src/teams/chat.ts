// Chat app: list chats, open one and read its messages (optionally loading older history).
import type { AxNode } from "../ax";
import { parseChatList, parseChatMessages, type ChatSummary, type Message } from "./parse";
import { ax, mainTitle, need, pick, switchApp, TeamsError, until } from "./session";

const DEEP = 60;

async function chatOutline(): Promise<AxNode> {
  const outline = await until(async () => {
    const [o] = await ax.find("main", { role: "AXOutline", title: "Chats" }, { depth: DEEP, limit: 1, subtree: 14, maxChildren: 500 });
    return o && parseChatList(o).length ? o : null;
  }, 8000, 300);
  if (!outline) throw new TeamsError("Could not find the chat list in Teams' UI.");
  return outline;
}

export async function listChats(): Promise<ChatSummary[]> {
  await switchApp("Chat");
  return parseChatList(await chatOutline());
}

/** Rows with their handles, for opening one. */
function chatRows(outline: AxNode): { row: AxNode; summary: ChatSummary }[] {
  const summaries = parseChatList(outline);
  const rows: AxNode[] = [];
  const visit = (n: AxNode) => {
    for (const c of n.children ?? []) {
      if (c.role === "AXRow" && /^(Unread message )?(Chat|Group chat|Meeting chat)\b/.test(c.title ?? "")) rows.push(c);
      else visit(c);
    }
  };
  visit(outline);
  return rows.map((row, i) => ({ row, summary: summaries[i]! }));
}

async function messageList(): Promise<AxNode> {
  const [list] = await ax.find("main", { title: "Message List" }, { depth: DEEP, limit: 1, subtree: 40, maxChildren: 1000, extra: ["AXURL"] });
  if (!list) throw new TeamsError("Could not find the open chat's messages in Teams' UI.");
  return list;
}

const key = (m: Message) => `${m.author}|${m.time}|${m.text.slice(0, 80)}`;

/** Prepend messages from `page` that are older than the first message already in `all`. */
export function mergeOlder<T extends Message>(all: T[], page: T[]): T[] {
  if (!all.length) return page;
  const first = key(all[0]!);
  const i = page.findIndex((m) => key(m) === first);
  const known = new Set(all.map(key));
  const older = (i >= 0 ? page.slice(0, i) : page).filter((m) => !known.has(key(m)));
  return [...older, ...all];
}

/** Scroll the first timestamp under `root` into view so Teams loads older items. Returns false if nothing moved. */
export async function loadOlder(root: string): Promise<boolean> {
  const first = await ax.findOne(root, { subrole: "AXTimeGroup" }, { depth: DEEP });
  if (!first) return false;
  const before = first.help ?? first.title;
  await ax.press(first.h, "AXScrollToVisible").catch(() => {});
  return !!(await until(async () => {
    const f = await ax.findOne(root, { subrole: "AXTimeGroup" }, { depth: DEEP });
    return f && (f.help ?? f.title) !== before;
  }, 5000, 300));
}

export async function readChat(name: string, opts: { limit: number; older: number }): Promise<{ chat: ChatSummary; messages: Message[]; truncated: boolean }> {
  await switchApp("Chat");
  const { row, summary } = pick(chatRows(await chatOutline()), name, (r) => r.summary.name, "chat");
  if (!row.selected) {
    await ax.press(row.h);
    const ok = await until(async () => (await mainTitle()).startsWith(`Chat | ${summary.name} |`), 6000);
    if (!ok) throw new TeamsError(`Teams did not open the chat '${summary.name}'.`);
  }
  await need("main", { title: "Message List" }, "the chat's message list", { depth: DEEP, timeoutMs: 8000 });
  // Wait until the first messages are rendered.
  await until(async () => (await ax.findOne("main", { subrole: "AXTimeGroup" }, { depth: DEEP })) ?? false, 6000, 300);
  let messages = parseChatMessages(await messageList());
  for (let i = 0; i < opts.older; i++) {
    const listNode = await ax.findOne("main", { title: "Message List" }, { depth: DEEP });
    if (!listNode || !(await loadOlder(listNode.h))) break;
    messages = mergeOlder(messages, parseChatMessages(await messageList()));
  }
  const truncated = messages.length > opts.limit;
  return { chat: { ...summary, unread: false }, messages: messages.slice(-opts.limit), truncated };
}
