# my-tooling — dotfiles

Personal dotfiles for **Linux and macOS** (Ubuntu is the main Linux; NixOS also
appears). Windows support was dropped on purpose; don't add it back. Configs
live here and `setup.sh` symlinks them into `$HOME`.

## Layout

```
setup.sh              Linux setup (primary); hands off to setup-macos.sh on macOS
setup-macos.sh        macOS setup with its own manifest
lib/link.sh           Symlink engine shared by both setup scripts
lib/os.sh             POSIX OS helpers: dotfiles_os, is_linux, is_macos, has_cmd
shell/
  init.sh             Shared entry point, sourced by bashrc and zshrc
  common/             Sourced by both shells: env.sh, aliases.sh, functions.sh
  os/linux.sh         OS-specific bits (apt/fwupd aliases, ls colors)
  os/macos.sh         (Homebrew shellenv, brew update alias)
  bash/bashrc         -> ~/.bashrc
  bash/bash_profile   -> ~/.bash_profile (sources ~/.bashrc)
  zsh/zshrc           -> ~/.zshrc
  zsh/zshenv          -> ~/.zshenv (cargo env, for every zsh incl. scripts)
nvim/                 -> ~/.config/nvim (Neovim 0.12+ config; uses vim.pack)
tmux/.tmux.conf       -> ~/.tmux.conf
vscode/               settings.json, keybindings.json -> VS Code's User dir
ssh/config            -> ~/.ssh/config (hosts + agent selection; includes the
                      untracked ~/.ssh/config.local)
lang/clang/.clang-format  -> ~/.clang-format
lang/clangd/config.yaml   -> clangd user config (path differs per OS)
agents/AGENTS.md      Global agent instructions -> ~/.claude/CLAUDE.md
                      and ~/.pi/agent/AGENTS.md (one file, two agents)
claude/settings.json  -> ~/.claude/settings.json
pi/                   pi coding agent config (formerly ~/dev/pi-harness); see
                      pi/README.md. extensions/ agents/ skills/ prompts/ themes/
                      keybindings.json mcp.json APPEND_SYSTEM.md are linked into
                      ~/.pi/agent/; settings.json is merged, not linked.
                      Machine-specific bits (models.json) stay untracked.
scripts/              Standalone utilities, not linked
                      (install-nvim-ubuntu.sh, nvidia-nix-link.sh)
nixos/templates/      Reference NixOS configuration.nix, not linked
```

## Setup scripts

- Always run `./setup.sh`. Linux is the primary target and is handled there
  directly. On macOS it `exec`s `setup-macos.sh` with the same arguments.
  Most work happens on the Linux side; macOS is kept as a separate, simpler
  route instead of OS conditionals inside one manifest.
- Flags (both scripts): none = link everything, `-n` dry run, `-s` status,
  `-u` remove the links that point into this repo.
- Idempotent. A real file at a destination is moved to
  `<dest>.backup.<timestamp>`, and a symlink pointing somewhere else is replaced.
- Each script just sets `$DOTFILES`, defines `manifest()` and calls
  `link_main "$@"`. The behavior lives in `lib/link.sh`.
- `merge_json <repo path> <dest> [jq filter]` is the alternative to `entry`
  for JSON an app rewrites itself (pi's settings.json): the repo file's keys
  are merged over the live file, the filter runs after, `-s` reports `DIFF` on
  drift. Needs `jq`.
- **To add a config:** put the file in the repo, then add one
  `entry <repo path> <destination>` line to `manifest()` in `setup.sh`. Add
  it to `setup-macos.sh` too if it applies there; macOS often puts things
  under `~/Library/...` instead of `~/.config/...`.
- Every script meant to be run by hand (`setup.sh`, `scripts/*`,
  `pi/dev-setup.sh`) takes `-h`/`--help` and exits 2 on unknown arguments.
- `setup-macos.sh` and `lib/link.sh` must run under **bash 3.2** (macOS
  `/bin/bash`): no associative arrays, no `mapfile`, no `readlink -f`, no
  `${var,,}`.

## Shell conventions

- Load order: `bashrc`/`zshrc` resolve their own symlink to find `$DOTFILES`,
  then source `shell/init.sh`. That sources `lib/os.sh`, then
  `shell/os/$DOTFILES_OS.sh`, `common/env.sh`, `common/aliases.sh`,
  `common/functions.sh`, and finally the untracked
  `~/.config/shell/local.sh` for per-machine overrides and secrets.
- Everything under `shell/common`, `shell/os` and `lib/` must parse in **both
  bash and zsh** (and `lib/os.sh` in plain `sh`). Only bash/zsh-specific
  settings (history, prompt, completion, shopt/setopt) go in the per-shell rc.
- Guard tool-specific aliases with `has_cmd`.
- Exported for use anywhere: `$DOTFILES`, `$DOTFILES_OS`, `$DEV` (`~/dev`).

## SSH notes

- `ssh/config` picks the 1Password agent socket (Linux or macOS path) only in
  a local session. Inside an ssh session (`$SSH_CONNECTION` set) it leaves
  `$SSH_AUTH_SOCK`, i.e. the forwarded agent, alone; otherwise the desktop
  1Password app would raise a GUI approval prompt nobody remote can answer.
- ssh takes the first value per option, so host blocks go above the agent
  `Match` blocks. Check resolution with `ssh -G <host>`.

## nvim notes

- `lua/utils.lua` has `is_linux`, `is_macos`, `pick_by_os({ linux=, macos= })`.
- Modules load through `safety.checked_require`, so one broken module doesn't
  take down the whole config.
- `nvim/nvim-pack-lock.json` is gitignored.

## Verifying changes

There are no tests. Before committing:
- `bash -n` / `zsh -n` on any changed shell files (both shells for shared ones).
- `HOME=$(mktemp -d) ./setup.sh` followed by `./setup.sh -s` gives a full run in
  a sandbox home. To exercise the macOS route, put a stub `uname` that prints
  `Darwin` for `-s` first on `PATH`.
- `HOME=<sandbox> bash -ic 'echo $DOTFILES'` and the same with `zsh -ic`
  check that the shells start up.

## Status (2026-10)

Done (branch `dotfiles-overhaul`):
- Removed the Windows tooling (`environment/windows`, VS Code `.bat` copiers,
  nvim `portable_environment`, Windows branches in nvim and VS Code settings).
- Restructured into the layout above: `setup.sh` (Linux) routes to
  `setup-macos.sh` on macOS, with shared `lib/link.sh` and `lib/os.sh`.
- Replaced the old per-tool link scripts (`tmux/symlink_conf.sh`, and the
  config-linking half of the nvim installer).
- Shared bash+zsh shell layer. The old repo `.bashrc` aliases/functions now
  live in `shell/common/functions.sh` and `shell/os/linux.sh`.
- Claude Code and pi share global instructions in `agents/AGENTS.md`.
- Ported the machine-independent parts of the retired `~/dev/pi-harness`
  repo into `pi/` (generic extensions, `/harness` prompt, keybindings,
  `hideThinkingBlock`; pi-only instructions in `APPEND_SYSTEM.md`). Left out
  on purpose: the old router-specific pieces (models.json,
  local-models/model-autostart/second-opinion extensions, the swift-serve
  skill, `ai.sh` shell helpers). The home model server (socrates,
  `~/serve/ai`) came back as `pi/extensions/home-models.ts`, since every
  LAN machine uses it.
  `setup.sh` relinks its old symlinks, backs up the old `extensions/` dir and
  drops its `packages` entry from pi's settings.json.
- Integrated this machine's old ~/.zshrc / ~/.zshenv: vi mode, `$` prompt,
  `~/.histfile`, NOTIFY/NO_BEEP, cargo env.

Caveats / open items:
- `setup.sh` has not been run against the real `$HOME` yet. The first run
  backs up the stock Ubuntu `~/.bashrc` and `~/.claude/settings.json`, and
  migrates `~/.pi/agent` off pi-harness (exercised in a sandbox copy).
- Claude Code and pi write to their own `settings.json` (e.g. `/config`
  changes). If either tool replaces the symlink with a regular file on save,
  `./setup.sh -s` will report it as `FILE`. Copy the changes back into the
  repo and re-link.
- Don't put machine-specific config (hardware, local services) in this
  repo; it targets several machines. Exception: the LAN-wide home model
  server in `pi/extensions/home-models.ts` and its search MCP server in
  `pi/mcp.json` (key read from 1Password into `$HOME_AI_KEY` by the `pi` shell function).
- `agents/AGENTS.md` is a starter. Grow it with real preferences.
- The macOS path has only been exercised with a stubbed `uname`, never on a
  real Mac.
- Candidates to add later: git config (global gitignore, aliases), ghostty or
  other terminal config, `.editorconfig`, rustfmt/ruff/prettier configs under
  `lang/`, a package bootstrap (apt list / Brewfile).
