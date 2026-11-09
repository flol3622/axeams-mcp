import { describe, expect, test } from "bun:test";
import type { AxNode } from "../src/ax";
import {
  authorFromHeading,
  parseChannelList,
  parseChannelPosts,
  parseChatList,
  parseChatMessages,
  parseFiles,
  parseTeamList,
  parseThread,
  textOf,
} from "../src/teams/parse";
import { mergeOlder } from "../src/teams/chat";

// Synthetic trees shaped like the ones Teams 26289 exposes (names and text are invented).
let n = 0;
const node = (role: string, props: Partial<AxNode> = {}, children: AxNode[] = []): AxNode => ({ h: `e${++n}`, role, ...props, ...(children.length ? { children } : {}) });
const g = (children: AxNode[], props: Partial<AxNode> = {}) => node("AXGroup", props, children);
const st = (value: string) => node("AXStaticText", { value });
const time = (full: string, short: string, dot = false) =>
  node("AXGroup", { subrole: "AXTimeGroup", title: full + (dot ? "." : ""), help: full }, [st(short)]);
const app = (title: string, children: AxNode[]) => node("AXGroup", { subrole: "AXApplicationGroup", title }, children);

describe("textOf", () => {
  test("paragraphs, mentions, links, blank lines and list markers", () => {
    const body = g([
      g([st("Hello ")]),
      g([st(" ")]),
      g([st("Ask "), node("AXPopUpButton", { title: "Mentioned Alex" }), st(" about "), node("AXLink", { title: "Link the doc", x: { AXURL: "https://example.org/doc" } }, [st("the doc")])]),
      node("AXList", {}, [g([node("AXListMarker", { value: "1. " }), st("first")]), g([node("AXListMarker", { value: "2. " }), st("second")])]),
      node("AXButton", { title: "see more" }),
    ]);
    expect(textOf(body)).toBe("Hello\n\nAsk @Alex about [the doc](https://example.org/doc)\n1. first\n2. second");
  });
});

describe("chat", () => {
  test("authorFromHeading", () => {
    expect(authorFromHeading("Quick question... by Alex Doe")).toBe("Alex Doe");
    expect(authorFromHeading("Message by Sam Roe, has an attachment.")).toBe("Sam Roe");
    expect(authorFromHeading("Day separator")).toBeNull();
  });

  test("messages, system lines, attachments and reactions", () => {
    const list = g(
      [
        g([
          node("AXHeading", { value: "3", title: "3 March" }),
          node("AXHeading", { value: "4", title: "Hi all by Alex Doe" }),
          g([time("3 March 2026 10:00", "03/03 10:00", true), g([g([st("Alex Doe")])]), app("Alex Doe Hi all", [node("AXButton", { title: "More message options" }), g([g([st("Hi all")])], { title: "Hi all" })])]),
          node("AXHeading", { value: "6", title: "03/03 10:05 - Meeting started" }),
          app("03/03 10:05 - Meeting started", [g([st("03/03 10:05"), st("Meeting started")])]),
          node("AXHeading", { value: "4", title: "Message by Sam Roe, has an attachment." }),
          g([
            g([g([st("Sam Roe")]), time("3 March 2026 10:07", "03/03 10:07", true)]),
            app("Sam Roe The message has an attachment.", [
              g([app("plan.pdf", [node("AXToolbar")])], { title: "The message has an attachment." }),
              node("AXToolbar", { title: "Reaction summary" }, [node("AXCheckBox", { title: "2 Like reactions." })]),
            ]),
          ]),
        ]),
      ],
      { title: "Message List" },
    );
    expect(parseChatMessages(list)).toEqual([
      { author: "Alex Doe", time: "3 March 2026 10:00", text: "Hi all" },
      { author: null, time: null, text: "03/03 10:05 - Meeting started", system: true },
      { author: "Sam Roe", time: "3 March 2026 10:07", text: "", attachments: ["plan.pdf"], reactions: ["2 Like reactions"] },
    ]);
  });

  test("chat list rows and sections", () => {
    const outline = node("AXOutline", { title: "Chats" }, [
      node("AXRow", { title: "Favorites" }, [st("Favorites"), app("", [node("AXRow", { title: "Chat Alex Doe Available Last message ok 02/03" }, [g([st("Alex Doe")]), time("02/03", "02/03"), st("ok")])])]),
      node("AXRow", { title: "Chats" }, [
        st("Chats"),
        app("", [node("AXRow", { title: "Unread message Group chat Project X Last message Sam: done", selected: true }, [node("AXImage"), st("Unread"), g([st("Project X")]), time("10:22", "10:22"), st("Sam: done")])]),
      ]),
    ]);
    expect(parseChatList(outline)).toEqual([
      { name: "Alex Doe", kind: "chat", section: "Favorites", unread: false, time: "02/03", preview: "ok" },
      { name: "Project X", kind: "group", section: "Chats", unread: true, time: "10:22", preview: "Sam: done", selected: true },
    ]);
  });

  test("mergeOlder prepends only unseen older messages", () => {
    const m = (t: string) => ({ author: "A", time: t, text: t });
    expect(mergeOlder([m("3"), m("4")], [m("1"), m("2"), m("3")]).map((x) => x.time)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("teams and channels", () => {
  test("team list", () => {
    const root = g([app("Team Alpha Team 1 of 2", [node("AXButton", { title: "Team Alpha" })]), app("Beta Team 2 of 2", [node("AXButton", { title: "Beta" })])]);
    expect(parseTeamList(root)).toEqual(["Team Alpha", "Beta"]);
  });

  test("channel list with sections", () => {
    const row = (title: string, level: number) => node("AXRow", { title, x: { AXDisclosureLevel: level } }, [st(title)]);
    const outline = node("AXOutline", {}, [g([row("Main Channels", 0), row("General", 1), row("Lab", 1), row("Hidden channels", 0)])]);
    expect(parseChannelList(outline)).toEqual([
      { name: "General", section: "Main Channels" },
      { name: "Lab", section: "Main Channels" },
    ]);
  });

  const post = () =>
    app("Alex Doe Weekly update ... Press Enter to open", [
      app("Alex Doe Weekly update", [g([st("Alex Doe")]), time("1 March 2026 09:00", "01/03 09:00"), node("AXHeading", { value: "2", title: "Weekly update" }, [st("Weekly update")]), g([g([st("Agenda below")])])]),
      g(
        [
          node("AXButton", { title: "Open 3 replies from Sam Roe" }),
          app("Sam Roe Thanks", [g([st("Sam Roe")], { subrole: "AXEmptyGroup", title: "Team message" }), time("2 March 2026 10:00", "02/03 10:00"), g([g([st("Thanks")])])]),
          app("Agreed", [g([g([st("Agreed")])])]),
        ],
        { title: "3 replies" },
      ),
      node("AXButton", { title: "Reply" }),
    ]);

  test("channel posts with inline replies and continuation author", () => {
    const posts = parseChannelPosts(g([post(), app("Kim Lee Scheduled a meeting ...", [app("Kim Lee Scheduled a meeting", [g([st("Kim Lee")]), time("4 March 2026 08:00", "04/03 08:00"), app("Scheduled meeting. Kickoff. 10:00 AM. Press enter to access", [st("Kickoff")]), st("Scheduled a meeting")]), node("AXButton", { title: "Reply" })])], { title: "Posts" }));
    expect(posts).toEqual([
      {
        author: "Alex Doe",
        time: "1 March 2026 09:00",
        subject: "Weekly update",
        text: "Agenda below",
        replyCount: 3,
        replies: [
          { author: "Sam Roe", time: "2 March 2026 10:00", text: "Thanks" },
          { author: "Sam Roe", time: null, text: "Agreed" },
        ],
      },
      { author: "Kim Lee", time: "4 March 2026 08:00", text: "[meeting: Kickoff. 10:00 AM]", replyCount: 0, replies: [] },
    ]);
  });

  test("thread view marks system lines", () => {
    const thread = g([app("Sam Roe Hi", [g([st("Sam Roe")]), time("2 March 2026 10:00", "02/03 10:00"), g([st("Hi")])]), app("02/03 10:01 Meeting started", [g([st("02/03 10:01 Meeting started")])]), app("More", [g([st("More")])])]);
    expect(parseThread(thread)).toEqual([
      { author: "Sam Roe", time: "2 March 2026 10:00", text: "Hi" },
      { author: null, time: null, text: "02/03 10:01 Meeting started", system: true },
      { author: "Sam Roe", time: null, text: "More" },
    ]);
  });

  test("shared files table", () => {
    const cell = (children: AxNode[], props: Partial<AxNode> = {}) => node("AXCell", props, children);
    const table = node("AXTable", { title: "General" }, [
      node("AXRow", { title: "Select all rows Type Name Modified" }, [cell([node("AXCheckBox", { title: "Select all rows" })])]),
      node("AXRow", { title: "Select row Yellow folder Reports" }, [
        cell([node("AXCheckBox", { title: "Select row" })]),
        cell([g([node("AXImage", { title: "Yellow folder" })])]),
        cell([node("AXButton", { title: "Reports" })]),
        cell([st("4 March")], { help: "3/4/2026 11:52" }),
        cell([node("AXPopUpButton", { title: "Opens profile card for Alex Doe" })]),
      ]),
    ]);
    expect(parseFiles(table)).toEqual([{ name: "Reports", type: "Yellow folder", modified: "3/4/2026 11:52", modifiedBy: "Alex Doe" }]);
  });
});
