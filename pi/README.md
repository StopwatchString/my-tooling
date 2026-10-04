# pi

Configuration for the [pi coding agent](https://github.com/earendil-works/pi).
`./setup.sh` at the repo root wires it into `~/.pi/agent/` (Linux and macOS).
Only machine-independent config lives here; anything tied to one machine's
hardware or local services (e.g. a local model server's `models.json`) stays
untracked in `~/.pi/agent/`.

Formerly the separate `~/dev/pi-harness` repo, which is retired.

## How it's wired

| Repo path | In `~/.pi/agent/` | How |
|---|---|---|
| `extensions/`, `skills/`, `prompts/`, `themes/` | same names | directory symlinks; pi auto-loads them |
| `keybindings.json` | `keybindings.json` | symlink (empty for now; see pi's `docs/keybindings.md`) |
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
| `hideThinkingBlock` | `true` | hide thinking in the transcript (`thinking-tokens.ts` removes the lines and puts the estimate in the working row; Ctrl+T toggles) |

To try a value without committing, edit the live file directly.

## Contents

- `extensions/`
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
