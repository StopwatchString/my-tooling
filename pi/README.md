# pi

Configuration for the [pi coding agent](https://github.com/earendil-works/pi).
`./setup.sh` at the repo root wires it into `~/.pi/agent/` (Linux and macOS),
together with the `pi/` directory of any downstream layer (see
`../docs/integration-guide.md`).
Only config that applies on every machine lives here. The one shared service
it knows about is the home model server (`home-models.ts`); secrets and
anything for a single machine stay untracked in `~/.pi/agent/` or
`~/.config/shell/local.sh`.

Formerly the separate `~/dev/pi-harness` repo, which is retired.

## How it's wired

| Repo path | In `~/.pi/agent/` | How |
|---|---|---|
| `extensions/`, `skills/` | same names | real dirs; each item symlinked; pi auto-loads them |
| `mcp.json` | `mcp.json` | **merged**; pi's built-in MCP servers (see below) |
| `../agents/AGENTS.md` | `AGENTS.md` | copied into a managed block; shared with Claude Code |
| `settings.json` | `settings.json` | **merged** (see below) |

Items with the same name in a later layer replace this repo's (setup warns).
Merged files take every layer's keys, later layers winning. Text in a file
outside the managed block is the host's own and comes last.

After changing anything, run `/reload` in pi (or restart it).

### Settings

pi rewrites `~/.pi/agent/settings.json` itself (package list, changelog
version, ...), so it is merged, not linked.
`settings.json` here holds the intended values; `./setup.sh` merges them into
the live file (repo wins for those keys, everything else is left alone) and
drops the old `pi-harness` package entry. `./setup.sh -s` reports `DIFF` when
the live file has drifted.

| Key | Value | Purpose |
|---|---|---|
| `defaultProvider` | `home` | start on the home model server (`home-models.ts`) |
| `defaultModel` | `swift` | its primary model |
| `quietStartup` | `"header"` | keep the header (`header.ts`, which also lists the context files) but hide pi's startup listings ([Context], [Skills], [Extensions], ...); warnings still show. `pi --verbose` brings the listings back for one run |
| `compaction.enabled` | `false` | no auto-compaction; run `/compact` by hand when the context fills up |

To try a value without committing, edit the live file directly.

### MCP servers

`mcp.json` uses pi's built-in MCP support (`docs/mcp.md`). Changes made in
`/mcp` (exposure, enable/disable) and `pi mcp add`/`remove` write to the live
`~/.pi/agent/mcp.json`. Servers added there stay; changes to a server defined
here are reset by the next `./setup.sh`, so copy those back. Keep only
servers every machine should have here.

| Server | What |
|---|---|
| `home-search` | Web search on the home server (socrates, `~/serve/search`: SearXNG + mcp-searxng) at `https://search.lab.masonspeck.com/mcp`. `searxng_web_search` and `web_url_read` are `direct` tools; the other two are hidden. Bearer key `$HOME_AI_KEY`, the same one as `home-models.ts`. Unlike the router, it needs the key on socrates too: `~/.config/shell/local.sh` there exports it from `~/serve/ai/.env`. Check with `pi mcp list`. |
| `sourcebot` | Code search on the home server (socrates, `~/serve/sourcebot`) at `https://code.lab.masonspeck.com/api/mcp`: grep/search over the indexed repos, file reads, symbol navigation, `ask_codebase` (answered by the router's model). Same `$HOME_AI_KEY`, sent as `Bearer sbk_${HOME_AI_KEY}` (Sourcebot API keys need the `sbk_` prefix); `~/serve/sourcebot/register-home-ai-key.sh` registers it there. |

## Contents

- `extensions/home-models.ts`: the home model server (socrates, `~/serve/ai`)
  as provider `home`: `swift` (full 256K context, vision, a copy on each GPU
  behind one endpoint, 4 requests at once, more queue). Reads the live list
  from `/v1/models`, falling back to a built-in copy if the server is
  unreachable, and adds a `home_models` system-prompt section. The key comes
  from `$HOME_AI_KEY`, which the `pi` shell function
  (`shell/common/functions.sh`) reads from 1Password
  (`op://Personal/home-ai-server/credential`, override with
  `HOME_AI_KEY_REF`) for each run, so client machines need only the `op` CLI,
  signed in. `HOME_AI_URL` overrides the default
  `https://ai.lab.masonspeck.com` (LAN or WireGuard). socrates itself needs
  neither.
- `extensions/header.ts`: replaces the startup header (logo, key hints,
  onboarding text) with the pi logo, version, current model and working
  directory, followed in grey by the loaded context files (what pi listed
  under `[Context]`). The other listings are off (`quietStartup`, above).
- `extensions/exit.ts`: `/exit`, an alias for pi's `/quit`
- `extensions/footer.ts`: replaces pi's two-line footer with one line in the
  style of the Claude Code status line: `user@host:dir` (zsh prompt colors),
  the model with its thinking level, and context fill (`ctx 8%`). Extension
  statuses still get a second line.
- `skills/`: empty (shared skills live in `../ai/skills/`)

Everything else is pi's stock behavior.

Not tracked (machine-local or secret, stay in `~/.pi/agent/`): `auth.json`,
`models.json`, `models-store.json`, `trust.json`, `sessions/`, `bin/`, `install/`.

## Development

```bash
npm run check   # links .pi-sdk, installs typescript once, type-checks extensions
```

See `AGENTS.md` for conventions.
