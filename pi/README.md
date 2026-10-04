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
| `agents/` | `agents` | directory symlink; subagent personalities (read by `extensions/agent/`) |
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
| `subagents.maxConcurrency` | `{ "default": 3 }` | subagents running at once, per model provider; add `"<provider>": n` for another endpoint (`extensions/agent/`). Read by the extension, not pi; `$PI_AGENT_MAX_CONCURRENCY` overrides the default |

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
  - `agent/`: subagents, in-process like Claude Code's. Tool `agent` hands a
    task (description + self-contained prompt) to a fresh session with the same
    tools and model; its final message comes back as the tool result.
    `background: true` returns an id at once and the result later arrives as
    an `agent-result` message that starts a turn once the main session is
    idle; `agent_wait` blocks on background agents instead (a result is
    delivered only once either way). A message from the user ends a wait
    early: `agent_wait` returns what has finished and a foreground agent moves
    to the background (Ctrl+C still stops it). `agent_send` steers a running agent or
    continues a finished one with its context; `agent_stop` aborts.
    `readonly: true` drops edit/write; `personality` picks a file from
    `agents/`. A `subagents` system-prompt section tells the model when to
    delegate (it does so on its own when asked for agents, parallel work, or
    broad searches) and lists the personalities. Children load the normal
    extensions, MCP and tool search, but not `agent/` itself (no nesting);
    they queue per provider over `subagents.maxConcurrency`. `/agents [id]`
    or Alt+A opens the agent switcher: a tab per agent (←/→ or click to
    switch) over its full live transcript; `e` shows full tool output, `s`
    stops the agent. Clicking an agent's tool block (or Ctrl+O) expands it to
    a live tail of the last 30 transcript lines. A widget shows the active ones
    with tool calls, tokens in/out and context fill. Running agents get a
    spinner cycling through the pi logo colors (`shimmer.ts`), in the widget
    and on their tool blocks.
    Transcripts and reports go to `$TMPDIR/pi-agents/<session>/<id>/`. The 8
    most recent finished agents stay open for `agent_send`.
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
- `agents/`: subagent personalities, one `.md` each: frontmatter `name`,
  `description`, optional `tools` (`+name`/`-name` against the defaults, or a
  bare list), `model` (`provider/id`), `thinking`, `then` (a personality that
  reviews each finished task; `VERDICT: FAIL` sends the findings back to fix),
  `rounds` (most reviews per task, default 2), `default: true` (used for agents
  that may edit files and name no personality); the body is appended to the
  subagent's system prompt. Read on every dispatch, so edits need no
  `/reload`. Trusted projects can add their own in `.pi/agents/`.
  - `implementer.md`: the default for code changes; implements to the spec,
    then `reviewer` checks it and it fixes what the review finds (up to 2
    reviews). The result is its report plus the final review.
  - `reviewer.md`: read-only correctness review, findings with file:line
- `skills/`, `themes/`: empty for now

Not tracked (machine-local or secret, stay in `~/.pi/agent/`): `auth.json`,
`models.json`, `models-store.json`, `trust.json`, `sessions/`, `bin/`, `install/`.

## Development

```bash
npm run check   # links .pi-sdk, installs typescript once, type-checks extensions
```

See `AGENTS.md` for conventions.
