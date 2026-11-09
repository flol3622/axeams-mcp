---
name: conventions
description: Set up or update the user's personal Teams conventions for axeams — where the files shared in their channels can be found locally (e.g. a synced cloud folder), which teams, channels and chats matter most, how to summarize, language. Use when the user asks to configure or personalise axeams/Teams behaviour, says things like "from now on look for channel files in X", or asks about Teams files and no conventions exist yet.
---

# Personal conventions (axeams)

axeams stores each user's own rules in one Markdown file: `~/.config/axeams/conventions.md`, or `$AXEAMS_CONFIG_DIR/conventions.md` if set. The server shows it to Claude in its instructions; `teams_get_conventions` returns the current version. The server never applies anything itself: the file is guidance for Claude.

## Setting up (first time, or "personalise axeams")

1. **Look first.** Call `teams_get_conventions`. If conventions exist, summarize them and ask what to change.
2. **Discover, don't guess.** Use `teams_list_teams` and `teams_list_chats` for real names. For files, check what exists on disk (for example a synced folder under `~/Library/CloudStorage/`) before writing a path.
3. **Interview briefly** (at most 3 questions), skipping anything the user doesn't care about:
   - **Files:** where can channel files be read? (a synced folder, or "ask me")
   - **Focus:** which teams, channels or chats matter most, and which to ignore.
   - **Style:** summary length, language.
4. **Draft the file** from the template, one line per rule. Never invent rules.
5. **Show it and get approval**, then call `teams_set_conventions` with the full text.

## Updating a rule

Read the file, change only the affected line, show the change, then save the whole file with `teams_set_conventions` (the previous version is kept as `conventions.md.bak`). A one-off instruction is not a convention.

## Template

```markdown
# Files
- Files shared in channels are synced under `<local folder>`; search there yourself (folders are named like "<team> - <channel>").

# Focus
- Most important: <teams / channels / chats>. Ignore: <…>.

# Style
- <summary length, language>
```

## Notes

- The file belongs to the user. Store only what they asked for: no message contents.
- Keep it under about 8,000 characters. Users can also edit it by hand.
