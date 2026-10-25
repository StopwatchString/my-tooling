# AGENTS.md — pi/

This directory holds the user's pi coding agent setup: the home model
server extension, skills and MCP servers. The user prefers stock pi; don't add
hand-built extensions, prompts, themes or settings without being asked.
**It is code that runs in pi.** A broken extension can stop pi from starting, so keep
changes small and always run the checks below. The repo-level `AGENTS.md`
still applies; this file adds the pi specifics.

## Layout

```
extensions/       pi extensions, one per .ts file or dir with index.ts (README) -> ~/.pi/agent/extensions
skills/           skills, one directory each with SKILL.md  -> ~/.pi/agent/skills
mcp.json          MCP servers, merged into the live mcp.json
settings.json     default provider/model, merged into the live settings.json
dev-setup.sh      links .pi-sdk and installs typescript (type-checking only)
```

`../setup.sh` makes the links and merges the JSON files; see `README.md`.
Don't register packages or put files in `~/.pi/agent/` directly; everything
goes here.

`.pi-sdk` (gitignored) is a symlink to the installed pi release's
`node_modules`. It exists only for type-checking and for reading docs.

## pi reference docs

Don't guess at the API. Read the docs and examples for the installed version:

```
.pi-sdk/@earendil-works/pi-coding-agent/docs/extensions.md     extension API (events, tools, commands, UI)
.pi-sdk/@earendil-works/pi-coding-agent/docs/skills.md         skills
.pi-sdk/@earendil-works/pi-coding-agent/docs/models.md         models.json format
.pi-sdk/@earendil-works/pi-coding-agent/docs/settings.md
.pi-sdk/@earendil-works/pi-coding-agent/examples/extensions/   working examples
.pi-sdk/@earendil-works/pi-coding-agent/dist/*.d.ts            exact types
```

Use `rg` over `.pi-sdk/@earendil-works/pi-coding-agent/dist` to find a type or
method name. Run `./dev-setup.sh` if `.pi-sdk` is missing.

## Conventions

- Extensions default-export `function (pi: ExtensionAPI) { ... }` (may be `async`).
- Start each extension with a short `/** ... */` header that lists what it registers
  (tools, commands, event hooks). See `extensions/home-models.ts`.
- Only import host-provided packages (`@earendil-works/pi-coding-agent`,
  `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`,
  `typebox`) and Node built-ins (`node:*`). Use `import type` for types only.
  Ask before adding any other dependency.
- Tabs for indentation, double quotes, semicolons (match `home-models.ts`).
- When adding or removing a resource, update the list in `README.md`.
- Secrets never go in this repo. `auth.json`, `models-store.json`, `sessions/`,
  and `trust.json` stay in `~/.pi/agent/` and are not tracked. Read keys at
  runtime from an untracked file.
- Nothing specific to one machine's hardware or local services. Keep that in
  `~/.pi/agent/` directly. The exception is the home model server, which every
  machine on the LAN uses: `home-models.ts` holds its address and model list,
  and `mcp.json` its web search (`home-search`) and code search (`sourcebot`) MCP servers.
  Its key comes from 1Password into `$HOME_AI_KEY` at launch, never from this repo.

## Checks (run all of these before saying you're done)

```bash
npm run check                                                      # type-check every extension
pi -ne -e ./extensions/<file>.ts -p --no-session "reply: ok"       # one extension loads alone
pi -p --no-session "reply: ok"                                      # full setup still starts
```

After the checks pass, ask the user to `/reload` and try the feature themselves.

## Notes for picking this up

The Claude Code look and the agent features (`tools.ts`, `tasks/`,
`modes.ts`, ...) are described in each extension's header and in
`README.md`. What isn't written there:

- **Test in a live TUI, in tmux.** The print-mode checks above only prove
  an extension loads. For anything visual or interactive, make a scratch
  agent dir (settings.json with the theme and models, `extensions/` holding
  symlinks to this repo's files) and run
  `tmux new-session -d -s pitest -x 130 -y 45 "PI_CODING_AGENT_DIR=<dir> pi"`.
  Then drive it with `tmux send-keys` (`BTab` is shift+tab) and read it with
  `tmux capture-pane -p` (`-e` keeps colours). The symlinks are live, so
  `/reload` picks up edits. Kill the session when done.
- **Patched pi internals:** `user-message.ts`, `assistant-message.ts` and
  `working.ts` patch exported component prototypes; `tasks/shells.ts`
  replaces the built-in `bash` tool. Recheck them after a pi upgrade.
- **Keys taken from pi:** shift+tab (`modes.ts`, was thinking-level cycling)
  and ↓ in an empty prompt (`tasks/`). Both use `ctx.ui.onTerminalInput`, not
  `registerShortcut`, so pi prints no conflict warning. Those listeners
  also receive key releases under the kitty protocol (Ghostty, not tmux),
  and `matchesKey` matches them, so skip `isKeyRelease(data)` first.
- **Shared state** lives on `globalThis` under `Symbol.for("my-tooling.*")`
  keys (`tasks.registry`, `modes`), so it survives `/reload` and subagent
  sessions (which load the same extensions in-process) share it.
- **Cross-extension contract:** `footer.ts` puts the status keyed `mode`
  at the right of its line; `modes.ts` sets it. `footer.ts` also shares its
  line builder as `globalThis[Symbol.for("my-tooling.footer")].line`, which
  the task view (`tasks/ui.ts`) calls for an agent; `context-bar.ts` adds
  `.bar` there while loaded. Extensions don't import each other's files.
- **Colours copied from Claude Code** (themes, diff palette in `tools.ts`)
  were read out of its binary (`strings` on `~/.local/share/claude/versions/*`);
  do the same when matching something new rather than guessing.
- **Open ideas:** safe mode checks read-only calls too (slower; Claude Code
  skips them); read-only mode blocks all bash, even read-only commands.

## Git

Small, focused commits with imperative subjects ("Add /exit command extension").
Standing permission from the user, limited to changes confined to `pi/`: when
such a change is complete and verified, commit it — do not ask or wait for
approval. Show the diff and the commit message in your reply for transparency,
but commit in the same turn. This does not cover changes elsewhere in the
dotfiles repo. Never push unless asked.
