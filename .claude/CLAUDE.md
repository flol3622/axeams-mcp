# Working on axeams-mcp

- **Runtime.** Bun for development (`bun test`, `bun run typecheck`, `bun run src/server.ts`). The shipped bundle `dist/axeams-mcp.js` must stay Node-compatible: no `Bun.*` or `from "bun"` in `src/`; use Node built-ins.
- **Layout.** `helper/TeamsAX.swift` holds generic Accessibility primitives only. Teams-specific selectors and flows live in `src/teams/*.ts`; pure tree parsing lives in `src/teams/parse.ts` so it can be unit-tested.
- **Read-only.** No tool may post, reply, react or change Teams settings.
- **Shipping.** `dist/` is committed because the Claude Code plugin runs it as is. After changing `src/` or `helper/`, run `bun run build` and commit `dist/` together with the source. `bin/` is a local dev build and must not be committed.
- **Checks before committing:** `bun test`, `bun run typecheck`, `claude plugin validate . --strict`.
- **Live testing:** `bun scripts/mcp-call.ts <tool> '<json>'` drives the real Teams (set `AXEAMS_HELPER=$PWD/bin/axeams-helper` after `bun run build:helper`).
- **Privacy.** Never commit real Teams data: no names, messages, team or channel names in tests, fixtures, docs or defaults.
- **Replies.** Keep them short and to the point: a verdict first, then at most a small table or a few bullets. Use a table or diagram instead of paragraphs when it is clearer. No recaps of what was just done, no option surveys.
