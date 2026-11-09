// Pure parsers from Teams accessibility subtrees (as returned by the helper's "tree"/"find --subtree")
// to plain data. No UI access here, so everything is unit-testable with captured trees.
import type { AxNode } from "../ax";

export interface Message {
  author: string | null;
  /** Timestamp as Teams states it in full, e.g. "7 October 2026 11:05" (null for continuation messages). */
  time: string | null;
  subject?: string;
  text: string;
  attachments?: string[];
  reactions?: string[];
  /** System line ("… started a meeting", "Meeting ended …"). */
  system?: boolean;
}

export interface Post extends Message {
  /** Total replies Teams reports for the thread (only some are shown inline). */
  replyCount: number;
  replies: Message[];
}

export interface ChatSummary {
  name: string;
  kind: "chat" | "group" | "meeting" | "other";
  section: string | null;
  unread: boolean;
  time: string | null;
  preview: string;
  selected?: boolean;
}

const clean = (s: string) => s.replace(/[   ​]/g, " ");
const kids = (n: AxNode) => n.children ?? [];

/** Depth-first visit; return false from `fn` to skip a node's children. */
export function walk(n: AxNode, fn: (n: AxNode) => boolean | void) {
  if (fn(n) === false) return;
  for (const c of kids(n)) walk(c, fn);
}

export function findAll(n: AxNode, pred: (n: AxNode) => boolean): AxNode[] {
  const out: AxNode[] = [];
  walk(n, (x) => {
    if (pred(x)) out.push(x);
  });
  return out;
}

export function findFirst(n: AxNode, pred: (n: AxNode) => boolean): AxNode | null {
  let hit: AxNode | null = null;
  walk(n, (x) => {
    if (hit) return false;
    if (pred(x)) {
      hit = x;
      return false;
    }
  });
  return hit;
}

const isTime = (n: AxNode) => n.subrole === "AXTimeGroup";
const timeOf = (n: AxNode | null) => (n ? (n.help ?? n.title ?? n.desc ?? "").replace(/\.$/, "").trim() || null : null);
const isAttachmentBox = (n: AxNode) => n.role === "AXGroup" && n.subrole !== "AXApplicationGroup" && /\battachment/i.test(n.title ?? "");
const isReactions = (n: AxNode) => n.role === "AXToolbar" && /reaction/i.test(n.title ?? n.desc ?? "");
const isMeetingCard = (n: AxNode) => n.subrole === "AXApplicationGroup" && /^Scheduled meeting\./.test(n.title ?? "");

/**
 * Readable text below a node. Groups are block-level (one line each), static text, links, mentions and
 * images are inline. `special` may return a replacement string, null to skip the node, or undefined.
 */
export function textOf(root: AxNode, special: (n: AxNode) => string | null | undefined = () => undefined): string {
  const lines: string[] = [];
  let line = "";
  const flush = () => {
    const t = line.replace(/[ \t]+/g, " ").trim();
    // A whitespace-only paragraph is a deliberate blank line; a mere block boundary is not.
    if (t || (line && lines.length && lines[lines.length - 1] !== "")) lines.push(t);
    line = "";
  };
  const visit = (n: AxNode, top: boolean) => {
    if (!top) {
      const s = special(n);
      if (s === null) return;
      if (typeof s === "string") {
        line += s;
        return;
      }
    }
    switch (n.role) {
      case "AXStaticText":
        line += clean(n.value ?? "");
        return;
      case "AXListMarker":
        flush();
        line += n.value ?? "";
        return;
      case "AXLink": {
        const label = kids(n).map((c) => textOf(c)).join("").trim() || (n.title ?? "").replace(/^Link\s+/, "").trim();
        const url = typeof n.x?.AXURL === "string" ? (n.x.AXURL as string) : null;
        line += url && url !== label && !url.startsWith("about:") ? `[${label}](${url})` : label;
        return;
      }
      case "AXImage": {
        const t = (n.title ?? n.desc ?? "").trim();
        if (t && !/^(Seen by|Sent|Default Thumbnail|Delivered)/i.test(t)) line += t === "image" ? "[image]" : `[image: ${t}]`;
        else if (!t && !kids(n).length) return;
        for (const c of kids(n)) visit(c, false);
        return;
      }
      case "AXPopUpButton": {
        const m = /^Mentioned (.+)$/.exec(n.title ?? n.desc ?? "");
        if (m) line += `@${m[1]}`;
        return;
      }
      case "AXButton":
      case "AXCheckBox":
      case "AXSplitter":
      case "AXMenuButton":
        return;
      case "AXToolbar":
        if (isReactions(n)) return;
    }
    flush();
    for (const c of kids(n)) visit(c, false);
    flush();
  };
  visit(root, true);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  while (lines.length && lines[0] === "") lines.shift();
  return lines.join("\n");
}

function reactionsOf(n: AxNode): string[] | undefined {
  const r = findAll(n, isReactions).flatMap((t) => findAll(t, (x) => x.role === "AXCheckBox").map((c) => (c.title ?? "").replace(/\.$/, "")));
  return r.length ? r : undefined;
}

function attachmentsOf(n: AxNode): string[] | undefined {
  const a = findAll(n, isAttachmentBox).flatMap((b) =>
    kids(b).length ? findAll(b, (x) => x.subrole === "AXApplicationGroup" && !!x.title).map((x) => x.title!) : [],
  );
  return a.length ? [...new Set(a)] : undefined;
}

// ------------------------------------------------------------------------------------------------
// Chat

/** "<preview> by <author>[, has an attachment.]" → author. */
export function authorFromHeading(title: string): string | null {
  const t = clean(title).replace(/\.$/, "");
  const i = t.lastIndexOf(" by ");
  if (i < 0) return null;
  return t.slice(i + 4).replace(/,\s*(has|with|contains)\b.*$/i, "").trim() || null;
}

/**
 * Messages of an open chat, oldest first. The "Message List" holds a flat sequence: a heading per message
 * (level 4; level 3 = day separator, level 6 = system line) followed by the message's group.
 */
export function parseChatMessages(list: AxNode): Message[] {
  let container: AxNode = list;
  let most = -1;
  walk(list, (n) => {
    const h = kids(n).filter((c) => c.role === "AXHeading").length;
    if (h > most) {
      most = h;
      container = n;
    }
  });
  const out: Message[] = [];
  let author: string | null | undefined;
  let skipCard = false;
  for (const c of kids(container)) {
    if (c.role === "AXHeading") {
      if (c.value === "3") continue;
      if (c.value === "6") {
        out.push({ author: null, time: null, text: clean(c.title ?? textOf(c)).trim(), system: true });
        skipCard = true;
        author = undefined;
        continue;
      }
      author = authorFromHeading(c.title ?? textOf(c));
      skipCard = false;
      continue;
    }
    if (skipCard && c.subrole === "AXApplicationGroup") {
      skipCard = false;
      continue;
    }
    if (author === undefined) continue;
    out.push(chatMessage(c, author));
    author = undefined;
  }
  return out;
}

function chatMessage(group: AxNode, author: string | null): Message {
  const time = findFirst(group, isTime);
  const body = findFirst(group, (n) => n.subrole === "AXApplicationGroup" && !isMeetingCard(n)) ?? group;
  if (!author) {
    const st = findFirst(group, (n) => n.role === "AXStaticText" && !!n.value?.trim() && !insideAny(group, n, [body, time]));
    author = st?.value?.trim() ?? null;
  }
  const m: Message = {
    author,
    time: timeOf(time),
    text: textOf(body, (n) => (isAttachmentBox(n) || isTime(n) ? null : undefined)),
  };
  const att = attachmentsOf(body);
  if (att) m.attachments = att;
  const re = reactionsOf(group);
  if (re) m.reactions = re;
  return m;
}

function insideAny(root: AxNode, target: AxNode, containers: (AxNode | null)[]): boolean {
  return containers.some((c) => c && c !== root && findFirst(c, (x) => x === target) !== null);
}

/** Rows of the Chat app's "Chats" outline. */
export function parseChatList(outline: AxNode): ChatSummary[] {
  const out: ChatSummary[] = [];
  const visit = (n: AxNode, section: string | null) => {
    for (const c of kids(n)) {
      if (c.role !== "AXRow") {
        visit(c, section);
        continue;
      }
      const title = clean(c.title ?? "");
      const m = /^(Unread message )?(Chat|Group chat|Meeting chat)\b/.exec(title);
      if (!m) {
        visit(c, title || section); // section header (Favorites, Chats, …): its rows sit in a child group
        continue;
      }
      const time = findFirst(c, isTime);
      const texts = findAll(c, (x) => x.role === "AXStaticText" && !!x.value?.trim() && !insideAny(c, x, [time])).map((x) => clean(x.value!).trim());
      const words = texts.filter((t) => t !== "Unread");
      out.push({
        name: words[0] ?? title,
        kind: m[2] === "Chat" ? "chat" : m[2] === "Group chat" ? "group" : "meeting",
        section,
        unread: !!m[1],
        time: time ? textOf(time) || null : null,
        preview: words.length > 1 ? words[words.length - 1]! : "",
        ...(c.selected ? { selected: true } : {}),
      });
    }
  };
  visit(outline, null);
  return out;
}

// ------------------------------------------------------------------------------------------------
// Teams and channels

/** Team names from the "All teams" list (groups titled "<name> Team 3 of 12"). */
export function parseTeamList(root: AxNode): string[] {
  return findAll(root, (n) => n.subrole === "AXApplicationGroup" && / Team \d+ of \d+$/.test(n.title ?? "")).map((g) => {
    const b = findFirst(g, (x) => x.role === "AXButton" && !!x.title);
    return b?.title ?? g.title!.replace(/ Team \d+ of \d+$/, "");
  });
}

/** Channel rows of a team's outline (needs extra AXDisclosureLevel). Level-0 rows are section headers. */
export function parseChannelList(outline: AxNode): { name: string; section: string | null }[] {
  const out: { name: string; section: string | null }[] = [];
  let section: string | null = null;
  walk(outline, (n) => {
    if (n.role !== "AXRow") return;
    const name = clean(n.title ?? textOf(n)).trim();
    if (Number(n.x?.AXDisclosureLevel ?? 1) === 0) section = name;
    else out.push({ name, section });
    return false;
  });
  return out;
}

export interface FileRow {
  name: string;
  type: string | null;
  modified: string | null;
  modifiedBy: string | null;
}

/** Rows of the SharePoint document table in a channel's Shared tab. */
export function parseFiles(table: AxNode): FileRow[] {
  return kids(table)
    .filter((r) => r.role === "AXRow" && /^Select row\b/.test(r.title ?? ""))
    .map((r) => {
      const cells = kids(r).filter((c) => c.role === "AXCell");
      const name = findFirst(r, (n) => n.role === "AXButton" && !!n.title) ?? findFirst(r, (n) => n.role === "AXLink" && !!n.title);
      const type = findFirst(r, (n) => n.role === "AXImage" && !!(n.title ?? n.desc));
      const modified = cells.find((c) => c.help && /\d/.test(c.help));
      const by = findFirst(r, (n) => n.role === "AXPopUpButton" && /^Opens profile card for /.test(n.title ?? ""));
      return {
        name: name?.title ?? "",
        type: type ? (type.title ?? type.desc)! : null,
        modified: modified ? modified.help! : null,
        modifiedBy: by ? by.title!.replace(/^Opens profile card for /, "") : null,
      };
    })
    .filter((f) => f.name);
}

const isCandidate = (n: AxNode) => n.subrole === "AXApplicationGroup" && !isMeetingCard(n) && !/ Team \d+ of \d+$/.test(n.title ?? "");

/** Message groups that contain no other message group (attachment cards don't count). */
function leafMessages(root: AxNode): { node: AxNode; wrapper: AxNode | null }[] {
  const out: { node: AxNode; wrapper: AxNode | null }[] = [];
  const visit = (n: AxNode, wrapper: AxNode | null) => {
    if (isAttachmentBox(n)) return false;
    if (isCandidate(n) && n !== root) {
      if (!hasCandidate(n)) {
        out.push({ node: n, wrapper });
        return;
      }
      wrapper ??= n;
    }
    for (const c of kids(n)) visit(c, wrapper);
  };
  visit(root, null);
  return out;
}

function hasCandidate(n: AxNode): boolean {
  let found = false;
  const visit = (x: AxNode) => {
    if (found || isAttachmentBox(x)) return;
    for (const c of kids(x)) {
      if (isCandidate(c)) {
        found = true;
        return;
      }
      visit(c);
    }
  };
  visit(n);
  return found;
}

/** One channel message group: author (text before the timestamp), time, optional subject heading, body. */
export function channelMessage(m: AxNode, prevAuthor: string | null): Message {
  const time = findFirst(m, isTime);
  const before: AxNode[] = [];
  if (time) {
    let done = false;
    walk(m, (n) => {
      if (done) return false;
      if (n === time) {
        done = true;
        return false;
      }
      if (n.role === "AXStaticText" && n.value?.trim()) before.push(n);
    });
  }
  const subject = findFirst(m, (n) => n.role === "AXHeading" && n.value === "2");
  const skip = new Set<AxNode>([...before, ...(time ? [time] : []), ...(subject ? [subject] : [])]);
  const msg: Message = {
    author: before.length ? clean(before[before.length - 1]!.value!).trim() : prevAuthor,
    time: timeOf(time),
    text: textOf(m, (n) => {
      if (skip.has(n) || isAttachmentBox(n)) return null;
      if (n.role === "AXStaticText" && n.value === "Scheduled a meeting") return null;
      if (isMeetingCard(n)) return `[meeting: ${meetingTitle(n)}]`;
      if (n.subrole === "AXEmptyGroup" && /^(Team|Channel) message$/.test(n.title ?? "")) return null;
      return undefined;
    }),
  };
  if (subject) msg.subject = clean(subject.title ?? textOf(subject)).trim();
  if (!time && /^\d{1,2}\/\d{1,2} \d{1,2}:\d{2}\s/.test(msg.text)) {
    // "25/09 12:11 Meeting started": a system line, not a continuation of the previous author.
    msg.author = null;
    msg.system = true;
  }
  const att = attachmentsOf(m);
  if (att) msg.attachments = att;
  const re = reactionsOf(m);
  if (re) msg.reactions = re;
  return msg;
}

function meetingTitle(card: AxNode): string {
  return clean(card.title ?? "")
    .replace(/^Scheduled meeting\.\s*/, "")
    .replace(/\.?\s*Press enter.*$/i, "")
    .trim();
}

/** Posts of a channel's Posts tab, oldest first, each with the replies Teams shows inline. */
export function parseChannelPosts(posts: AxNode): Post[] {
  const out: Post[] = [];
  let cur: { wrapper: AxNode | null; post: Post } | null = null;
  let lastAuthor: string | null = null;
  for (const { node, wrapper } of leafMessages(posts)) {
    if (cur && wrapper && cur.wrapper === wrapper) {
      const r = channelMessage(node, lastAuthor);
      if (!r.system) lastAuthor = r.author;
      cur.post.replies.push(r);
      continue;
    }
    const root = channelMessage(node, null);
    lastAuthor = root.author;
    const countBox: AxNode | null = wrapper ? findFirst(wrapper, (n) => /^\d+ repl(y|ies)$/.test(n.title ?? "")) : null;
    cur = { wrapper, post: { ...root, replyCount: countBox ? Number.parseInt(countBox.title!, 10) : 0, replies: [] } };
    out.push(cur.post);
  }
  return out;
}

/** All messages of an opened thread (root post first). */
export function parseThread(root: AxNode): Message[] {
  const out: Message[] = [];
  let last: string | null = null;
  for (const { node } of leafMessages(root)) {
    if (!findFirst(node, (n) => n.role === "AXStaticText" && !!n.value?.trim())) continue;
    const m = channelMessage(node, last);
    if (!m.system) last = m.author;
    out.push(m);
  }
  return out;
}
