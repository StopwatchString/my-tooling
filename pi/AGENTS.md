# AGENTS.md — pi/

This directory is the source of truth for the user's pi coding agent setup:
extensions, skills, prompt templates, and themes. **It is the
code that runs pi.** A broken extension can stop pi from starting, so keep
changes small and always run the checks below. The repo-level `AGENTS.md`
still applies; this file adds the pi specifics.

## Layout

```
extensions/       pi extensions, one feature per .ts file   -> ~/.pi/agent/extensions
skills/           skills, one directory each with SKILL.md  -> ~/.pi/agent/skills
prompts/          prompt templates; foo.md becomes /foo     -> ~/.pi/agent/prompts
themes/           theme .json files                         -> ~/.pi/agent/themes
keybindings.json  custom keybindings
APPEND_SYSTEM.md  pi-only global instructions (shared ones: ../agents/AGENTS.md)
settings.json     intended settings values, merged into the live settings.json
dev-setup.sh      links .pi-sdk and installs typescript (type-checking only)
```

`../setup.sh` makes the links and merges `settings.json`; see `README.md`.
Don't register packages or put files in `~/.pi/agent/` directly; everything
goes here.

`.pi-sdk` (gitignored) is a symlink to the installed pi release's
`node_modules`. It exists only for type-checking and for reading docs.

## pi reference docs

Don't guess at the API. Read the docs and examples for the installed version:

```
.pi-sdk/@earendil-works/pi-coding-agent/docs/extensions.md     extension API (events, tools, commands, UI)
.pi-sdk/@earendil-works/pi-coding-agent/docs/skills.md         skills
.pi-sdk/@earendil-works/pi-coding-agent/docs/prompt-templates.md
.pi-sdk/@earendil-works/pi-coding-agent/docs/themes.md
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
  (tools, commands, event hooks). See `extensions/compact-tools.ts`.
- Only import host-provided packages (`@earendil-works/pi-coding-agent`,
  `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`,
  `typebox`) and Node built-ins (`node:*`). Use `import type` for types only.
  Ask before adding any other dependency.
- Tabs for indentation, double quotes, semicolons (match `compact-tools.ts`).
- Name files after the command or tool they add (`exit.ts` → `/exit`).
- When adding or removing a resource, update the list in `README.md`.
- Secrets never go in this repo. `auth.json`, `models-store.json`, `sessions/`,
  and `trust.json` stay in `~/.pi/agent/` and are not tracked. Read keys at
  runtime from an untracked file.
- Nothing specific to one machine's hardware or local services (model
  servers, GPUs, provider catalogs). Keep that in `~/.pi/agent/` directly.

## Checks (run all of these before saying you're done)

```bash
npm run check                                                      # type-check every extension
pi -ne -e ./extensions/<file>.ts -p --no-session "reply: ok"       # one extension loads alone
pi -p --no-session "reply: ok"                                      # full setup still starts
```

After the checks pass, ask the user to `/reload` and try the feature themselves.

## Git

Small, focused commits with imperative subjects ("Add /exit command extension").
Standing permission from the user, limited to changes confined to `pi/`: when
such a change is complete and verified, commit it — do not ask or wait for
approval. Show the diff and the commit message in your reply for transparency,
but commit in the same turn. This does not cover changes elsewhere in the
dotfiles repo. Never push unless asked.
