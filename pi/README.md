# pi

Configuration for the [pi coding agent](https://github.com/earendil-works/pi).
`./setup.sh` at the repo root wires it into `~/.pi/agent/` (Linux and macOS).
Only config that applies on every machine lives here. The one shared service
it knows about is the home model server (`home-models.ts`); secrets and
anything for a single machine stay untracked in `~/.pi/agent/` or
`~/.config/shell/local.sh`.

Formerly the separate `~/dev/pi-harness` repo, which is retired.

## How it's wired

| Repo path | In `~/.pi/agent/` | How |
|---|---|---|
| `extensions/`, `skills/`, `prompts/`, `themes/` | same names | directory symlinks; pi auto-loads them |
| `keybindings.json` | `keybindings.json` | symlink (empty for now; see pi's `docs/keybindings.md`) |
| `mcp.json` | `mcp.json` | symlink; pi's built-in MCP servers (see below) |
| `APPEND_SYSTEM.md` | `APPEND_SYSTEM.md` | symlink; pi-only instructions appended to the system prompt |
| `../agents/AGENTS.md` | `AGENTS.md` | symlink; shared with Claude Code |
| `settings.json` | `settings.json` | **merged**, not linked (see below) |

After changing anything, run `/reload` in pi (or restart it).

### Settings

pi rewrites `~/.pi/agent/settings.json` itself (package list, changelog
version, Ctrl+T toggling `hideThinkingBlock`, ...), so it is not symlinked.
`settings.json` here holds the intended values; `./setup.sh` merges them into
the live file (repo wins for those keys, everything else is left alone) and
drops the old `pi-harness` package entry. `./setup.sh -s` reports `DIFF` when
the live file has drifted.

| Key | Value | Purpose |
|---|---|---|
| `defaultProvider` | `home` | start on the home model server (`home-models.ts`) |
| `defaultModel` | `swift` | its primary model |
| `hideThinkingBlock` | `true` | hide thinking in the transcript (`thinking-tokens.ts` removes the lines and puts the estimate in the working row; Ctrl+T toggles) |

To try a value without committing, edit the live file directly.

### MCP servers

`mcp.json` uses pi's built-in MCP support (`docs/mcp.md`). Changes made in
`/mcp` (exposure, enable/disable) and `pi mcp add`/`remove` write through the
symlink into this repo, so they show up in `git diff`; keep only servers every
machine should have here.

| Server | What |
|---|---|
| `home-search` | Web search on the home server (socrates, `~/serve/search`: SearXNG + mcp-searxng) at `http://192.168.0.41:8090/mcp`. `searxng_web_search` and `web_url_read` are `direct` tools; the other two are hidden. Bearer key `$HOME_AI_KEY`, the same one as `home-models.ts`. Unlike the router, it needs the key on socrates too: `~/.config/shell/local.sh` there exports it from `~/serve/ai/.env`. Check with `pi mcp list`. |

## Contents

- `extensions/`
  - `home-models.ts`: the home model server (socrates, `~/serve/ai`) as provider
    `home`: `swift` (full 256K context, vision, a copy on each GPU behind one
    endpoint, 4 requests at once, more queue). Reads the live list from
    `/v1/models`, falling back to a built-in copy if the server is unreachable,
    and adds a `home_models` system-prompt section. The key comes from
    `$HOME_AI_KEY`, which the `pi` shell function (`shell/common/functions.sh`)
    reads from 1Password (`op://Personal/home-ai-server/credential`, override
    with `HOME_AI_KEY_REF`) for each run, so client machines need only the
    `op` CLI, signed in. `HOME_AI_URL` overrides the default
    `http://192.168.0.41:8000`. socrates itself needs neither.
  - `exit.ts`: `/exit` command (clean shutdown via `ctx.shutdown()`)
  - `compact-tools.ts`: compact renderers for the built-in tools — bash and read
    collapse to one line (Ctrl+O expands, first 20 lines), edit shows the full
    diff, write shows its one-line result
  - `thinking-tokens.ts`: appends a live token count to the animated working
    row ("Working (214 tok)") while the model thinks; thinking lines are
    removed from the transcript entirely (pi's hidden label is global to all
    blocks). Press Ctrl+T to show thinking blocks; note this saves
    `hideThinkingBlock` to settings, and `./setup.sh` resets it
- `prompts/`
  - `harness.md`: `/harness [task]` has pi make a change to this directory
    (asks what to fix if no task is given)
- `skills/`, `themes/`: empty for now

Not tracked (machine-local or secret, stay in `~/.pi/agent/`): `auth.json`,
`models.json`, `models-store.json`, `trust.json`, `sessions/`, `bin/`, `install/`.

## Development

```bash
npm run check   # links .pi-sdk, installs typescript once, type-checks extensions
```

See `AGENTS.md` for conventions.
