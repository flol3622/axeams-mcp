---
name: teams
description: Use the axeams MCP tools (teams_*) whenever the user asks anything about their Microsoft Teams chats or channels — reading, finding or summarizing chats, group or meeting chats, teams, channels, posts, threads, replies, mentions, or the files shared in a channel. They read the user's running Microsoft Teams for Mac. Use them even when the user does not say "Teams", unless they explicitly name another source.
---

# Microsoft Teams (axeams)

The `axeams` MCP server reads the user's **Microsoft Teams for Mac** through macOS Accessibility. It is read-only: it never posts, replies or reacts.

## Workflow

1. **Discover first, never guess.**
   - Chats: `teams_list_chats` returns names, kind (chat, group, meeting), unread flag and preview.
   - Channels: `teams_list_teams`, then `teams_list_channels` for one team.
2. **Read.**
   - `teams_read_chat` returns a chat's messages, oldest first.
   - `teams_read_channel` returns posts with their reply count and the replies Teams shows inline.
   - `teams_read_thread` opens one post (pass words from its subject or text) and returns every reply.
3. **Older history.** Only what Teams has loaded is visible. Pass `older` (1–20) to scroll back first.
4. **Files.** `teams_list_files` lists the names in a channel's Shared tab; it does not read contents. Where contents can be read is a personal convention (see below).

## Personal conventions come first

The user may have saved their own rules (where channel files live on disk, which teams matter, summary style). They appear in the server instructions; `teams_get_conventions` returns the current version. Follow them. If none exist and the user asks about files or states a lasting preference, offer to set them up with the `conventions` skill.

## Good to know

- Names match case-insensitively: exact, then prefix, then substring. An ambiguous name returns the candidates.
- Opening a chat or channel marks it read in Teams and changes what Teams shows.
- Calls take 1–5 seconds and run one at a time. Avoid needless calls.
- Times are as Teams states them, e.g. `7 October 2026 11:05`. `time: null` means a follow-up message by the same author.
- **When a call fails, check `teams_status` first:** `screenLocked: true` means the Mac must be unlocked; `trusted: false` means the app running Claude needs Accessibility permission (System Settings → Privacy & Security → Accessibility, then restart that app); `running: false` means Teams must be started.

## Response style

Give the chat or channel, then author, local time and a short gist. Say so when results only cover the loaded part of the history.
