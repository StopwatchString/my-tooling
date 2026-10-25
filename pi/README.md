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
| `extensions/`, `skills/`, `themes/` | same names | real dirs; each item symlinked; pi auto-loads them |
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
| `theme` | `claude-light/claude-dark` | Claude Code's colours (`themes/`), light or dark to match the terminal |

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
  onboarding text) with the pi logo, version and working directory
  (the model is in the footer), followed in grey by the loaded context files (what pi listed
  under `[Context]`). The other listings are off (`quietStartup`, above).
- `extensions/exit.ts`: `/exit` quits pi. Hides `/quit`, `/share`, `/bug`,
  `/fork`, `/clone`, `/llama`, `/tree`, `/export`, `/import` and `/changelog`
  from the `/` menu (`HIDDEN`; typing one still works, pi has no way to
  remove built-ins)
- `extensions/footer.ts`: replaces pi's two-line footer with one line in the
  style of the Claude Code status line: `user@host:dir` (zsh prompt colors),
  the model with its thinking level, and context fill (`ctx 8%`). The
  permission mode (`modes.ts`) sits at the right; other extension statuses
  still get a second line. The task view (`tasks/`) ends with the same line
  for the agent it shows.
- `extensions/context-bar.ts` (experimental): a bar the width of the
  terminal above the footer's line that fills with the context, shading from
  green through yellow (70%) to red (90%). The task view shows it for an
  agent. Delete the file and `/reload` to drop it; the footer draws it only
  while it is loaded.
- `extensions/editor.ts`: the input box in the style of Claude Code's prompt:
  grey rules above and below (instead of rules coloured by thinking level)
  and a `>` before the text. In bash mode (`!`), the rules and the `>` take the
  bash-mode colour. pi's `editorPaddingX` setting is ignored.
- `extensions/user-message.ts`: sent messages in the style of Claude Code's
  transcript: `> ` before the text on a one-line `userMessageBg` band,
  instead of pi's padded block. pi has no
  hook for this, so it patches the exported `UserMessageComponent`; check it
  still works after a pi upgrade.
- `extensions/working.ts`: Claude Code's working status. While pi works:
  `✢ Gesticulating… (13s · ↓ 624 tokens · esc to interrupt)` with Claude
  Code's spinner and verbs; when done, `✻ Churned for 19s · ↓ 1.2k tokens ·
  done 12:04 AM` stays in the transcript (a custom entry, not sent to the
  model). Tokens are estimated while streaming and replaced by the
  provider's count per message. Thinking is never shown: it patches the
  exported `AssistantMessageComponent` to drop thinking blocks (check after
  a pi upgrade).
- `extensions/tools.ts`: tool calls in the style of Claude Code's
  transcript: `⏺ Bash(git status)` with the result under `⎿`, no panel.
  The bullet blinks while the call runs, then turns green, or red on an error.
  Bash, MCP and other output is cut to 3 lines, and a new file to its first 10.
  Read, grep, find and ls show only a summary ("Read 125 lines"), and a run of
  them with no text in between folds into one line ("Read 3 files"). Edits
  show "Updated <file> with 1 addition and 1 removal" and the diff the way
  Claude Code draws it: numbered, syntax-highlighted lines, removed and added
  ones on dark red and green bands (the colours of its own diff view, dark or
  light by theme), with the changed words in a stronger shade. MCP tools
  read `server - tool (MCP)(args)`. pi's expand key (`ctrl+o`) or a click on a row
  shows every call in full. Uses pi's `registerToolRenderer`, so it covers
  every tool without patching.
- `extensions/assistant-message.ts`: a `⏺` before each block of assistant
  text, like tool calls. pi has no hook for this, so it patches the exported
  `AssistantMessageComponent` (check after a pi upgrade).
- `extensions/modes.ts`: permission modes like Claude Code's, cycled with
  shift+tab (which no longer cycles the thinking level) or set with `/mode`,
  and shown at the right of the footer:
  - `⏸ read-only` (lavender): only tools that read or look things up. A tool
    counts when its `readOnlyHint` annotation says so: MCP servers declare it
    per tool (all of home-search's, and sourcebot's except `create_skill` and
    `update_skill`), and our own tools set it where they register
    (`bash_output`, `task_log`, `task_list`). pi's built-in readers (read,
    grep, find, ls) carry no hints and are listed in `READ_TOOLS`, with the
    tools that only run other tools (agent, codemode, tool_search), whose
    calls are checked too. `READ_ONLY_OVERRIDES` corrects a server's hints,
    per server or tool. Anything else is blocked: bash, edit, write,
    task_stop. Annotations are never sent to the model, so this costs no
    context.
  - `⏵⏵ safe` (yellow, Claude Code's auto mode): every tool call goes to a
    model first, with the user's latest messages, and runs only if it answers
    ALLOW; a block reason goes back to the agent. If the check fails, pi asks
    you. `/safe-model` picks the checking model from pi's models (default: the
    session's); the choice is saved in `~/.pi/agent/modes.json`.
  - `⏵⏵ unsafe` (red): stock pi, nothing checked. Every start begins here.
  The mode applies to subagents too, survives `/reload`, and is added to the
  system prompt in read-only and safe mode.
- `extensions/tasks/`: background shells and subagents, in the style of Claude
  Code. While one runs, the model ends its turn, and a message with the result
  starts its next turn when the task ends.
  - `bash` (replaces pi's) takes `run_in_background`. `bash_output` reads
    what a background shell has printed since the last look. Output is also
    logged to `$TMPDIR/pi-tasks/`.
  - `agent` starts a subagent: a fresh pi session in this process, in a
    working directory the model picks, with auto-compaction on (the setting
    is off for the main session) and the same model, extensions and MCP
    servers. `allow_subagents` decides whether it gets `agent` itself. Its
    final message is the answer. An agent finishes only once everything it
    started has finished too.
  - `agent_message` sends an agent more instructions. A running agent reads
    them after its current step. A finished or stopped one carries on with
    its context and answers again. One from before a restart starts afresh,
    with its saved conversation as context.
  - `task_stop` stops a shell or agent and everything it started.
  - Tasks are saved in the session file as hidden `task` entries, never
    sent to the model. For a shell: its command, status, exit code and the
    last 20 KB of output. For an agent: its conversation, meaning the
    orchestrator's messages, the agent's text replies, and its tool calls
    with their results (arguments cut to 2 KB, results to 4 KB, keeping the
    start and end), without thinking. Subagents' own tasks go into the top-level session.
    After a restart (`pi -c`), tasks that were running show as
    interrupted. `task_log` gives the model a task's record and
    `task_list` lists the tasks.
  - The list below the prompt shows the tasks, with subagents' own tasks
    nested under them, and an agent's context fill (`ctx 6%`). ↓ in an empty
    prompt moves into it: enter opens a full-screen view (a shell's command
    and its live output, or an agent's prompt and live transcript, with the
    footer's status line for it: directory, model, context fill, mode), and
    x stops the task. Finished tasks stay
    listed until you send your next prompt. `/tasks` lists every task in the
    session, finished ones included.
  - Quitting pi or switching sessions stops the session's tasks (recorded
    as interrupted) and ends its agents' sessions; `/reload` keeps them.
- `themes/claude-dark.json`, `claude-light.json`: Claude Code's dark and
  light palettes (taken from its binary, v2.1.310), mapped onto pi's colour
  roles: lavender inline code, links and accent (Claude Code's own accent,
  its orange, is left out), grey prompt rules, pink bash mode, no panels
  behind tool calls, and the code highlighting Claude Code uses (Monokai
  Extended on dark, GitHub on light). Var names follow Claude Code's theme
  keys.
- `skills/`: empty (shared skills live in `../ai/skills/`)

Everything else is pi's stock behavior.

Not tracked (machine-local or secret, stay in `~/.pi/agent/`): `auth.json`,
`models.json`, `models-store.json`, `trust.json`, `modes.json`, `sessions/`, `bin/`, `install/`.

## Development

```bash
npm run check   # links .pi-sdk, installs typescript once, type-checks extensions
```

See `AGENTS.md` for conventions.
