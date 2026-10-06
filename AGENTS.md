# my-tooling — dotfiles

Personal dotfiles for **Linux and macOS** (Ubuntu is the main Linux; NixOS also
appears). Windows support was dropped on purpose; don't add it back.

This repo is the **base layer** of a layered build. `setup.sh` assembles each
config from a stack of layers: this repo, then any downstream repos (each
runs its own `setup.sh`, which execs this one with `--layer <dir>`), then the
untracked host layer `~/.config/dotfiles/host/`. Later layers win, and the
host's own files win over everything. Run on its own, `setup.sh` treats
this repo as the last layer and removes what an earlier run built from
layers that aren't in the stack any more. How downstream repos plug in:
`docs/integration-guide.md`. Keep it in sync with `layer.sh`.

## Layout

```
setup.sh              Entry point (Linux and macOS): sources lib/build.sh
layer.sh              This repo's targets: what goes where, and the path
                      conventions downstream layers fill in
lib/build.sh          Layered build engine (targets, status, prune, uninstall)
lib/os.sh             POSIX OS helpers: dotfiles_os, is_linux, is_macos, has_cmd
lib/nvim-layers.lua   Puts every layer's nvim/ on the runtimepath, runs its init.lua
docs/integration-guide.md  How to build a downstream layer (written for agents)
shell/                Stages, sourced per layer by the generated loaders
  common/             Both shells: env.sh, aliases.sh, functions.sh
  os/linux.sh         OS-specific bits (apt/fwupd aliases, ls colors)
  os/macos.sh         (Homebrew shellenv, brew update alias)
  bash/rc.bash        bash history, prompt, completion (last bash stage)
  zsh/early.zsh       submodule self-heal, p10k instant prompt (first zsh stage)
  zsh/rc.zsh          zsh options, keys, plugins, prompt (last zsh stage)
  zsh/env.zsh         cargo env, for every zsh incl. scripts (~/.zshenv)
  zsh/p10k.zsh        Powerlevel10k config, sourced from the repo
  zsh/plugins/        git submodules: powerlevel10k, zsh-autosuggestions
nvim/                 Neovim 0.12+ config (uses vim.pack), loaded from a block
                      in ~/.config/nvim/init.lua
tmux/tmux.conf        source-file'd from a block in ~/.tmux.conf
ghostty/config        copied into a block in ~/.config/ghostty/config
gnome-terminal/profile.dconf  GNOME Terminal profile (Solarized Dark, font);
                      loaded by setup.sh via scripts/gnome-terminal-profile.sh
fonts/                UbuntuMono Nerd Font Mono TTFs, installed by setup.sh via
                      scripts/install-fonts.sh (also sets GNOME Terminal /
                      Ptyxis to the font; Ghostty sets it in ghostty/config)
vscode/               settings.json, keybindings.json: merged into VS Code's
                      User dir (JSONC comments allowed)
ssh/config            Include'd from a block at the bottom of ~/.ssh/config
lang/clang/.clang-format  -> ~/.clang-format (highest layer wins)
lang/clangd/config.yaml   joined into the clangd user config (path per OS)
agents/AGENTS.md      Global agent instructions, copied into blocks in
                      ~/.claude/CLAUDE.md and ~/.pi/agent/AGENTS.md
claude/settings.json  merged into ~/.claude/settings.json
ai/skills/            Agent skills, each linked into ~/.agents/skills (pi)
                      and ~/.claude/skills (Claude Code)
pi/                   pi coding agent config (formerly ~/dev/pi-harness); see
                      pi/README.md. extensions/ agents/ skills/ prompts/ themes/
                      items are linked into ~/.pi/agent/<dir>/; settings.json,
                      keybindings.json, mcp.json are merged; APPEND_SYSTEM.md
                      goes in a block. Machine-specific bits stay untracked.
scripts/              Standalone utilities, not linked (install-nvim.sh,
                      nvidia-nix-link.sh, install-fonts.sh,
                      gnome-terminal-profile.sh load|export, cheatsheet.sh
                      a.k.a. the `cheat` alias)
nixos/templates/      Reference NixOS configuration.nix, not linked
```

## Setup

- Always run `./setup.sh` (both OSes; OS differences are `is_macos`
  conditionals in `layer.sh`). Flags: none = build everything, `-n` dry run,
  `-s` status, `-u` uninstall, `--layer DIR` (repeatable), `--skip PATTERN`.
- `lib/build.sh` sources each layer's `layer.sh` in stack order. Targets run
  as they're declared and each one gathers its path from **every** layer:
  - `link <path> <dest>`: symlink to the highest layer's file.
  - `link_each <dir> <dest dir>`: link every item of `<dir>` from every
    layer; same name in two layers → later wins, with a `WARN`. A
    `.remove-<item>` file in a layer's `<dir>` lists item names (one per
    line) it removes from lower layers.
  - `block <dest> top|bottom hash|lua|html <render...>`: a marked block in a
    file the host owns; the host's lines outside it win.
  - `generate <dest> <render...>`: a whole generated file (no includes
    possible); host overrides go in the host layer.
  - `json <path> <dest> [filter]`: deep-merge every layer's JSON(C) over the
    live file, for files the app also writes. Removes keys a layer stops
    setting; a `null` value deletes the key, so a higher layer can drop a
    lower layer's key. Needs `jq`.
  - `step <name> <check fn> <apply fn>`: setup that isn't a file (zsh plugin
    submodules, fonts + terminal font, Neovim nightly, GNOME Terminal
    profile). The apply only runs when the check fails. Scripts that back a
    step take a `--check`/`check` mode that changes nothing and exits 0 when
    already done.
  - `shadow_check <dir>`: warn when two layers have the same file (nvim/lua).
  - Renderers for block/generate: `render_concat`, `render_each`,
    `render_lines`, plus `render_shell`/`render_nvim`/... in `layer.sh`.
- What was built is recorded in `~/.config/dotfiles/build/managed`
  (generated loaders and JSON state live there too). The next run removes
  whatever it no longer declares; `-s` shows those as `stale`.
- Idempotent. Files in the way are moved to `<dest>.backup.<timestamp>`; old
  symlinks into a layer (the pre-layering setup) are replaced, including
  whole-directory ones like `~/.config/nvim`.
- **To add a config:** put the file under a conventional path, then declare a
  target in `layer.sh` with the matching kind (prefer `block` when the format
  has includes or "later wins", `link_each` for directories of named items,
  `json` for app-written JSON). Then document the path in the integration
  guide's conventions table.
- Every script meant to be run by hand (`setup.sh`, `scripts/*`,
  `pi/dev-setup.sh`) takes `-h`/`--help` and exits 2 on unknown arguments.
- `setup.sh`, `layer.sh` and `lib/build.sh` must run under **bash 3.2** (macOS
  `/bin/bash`): no associative arrays, no `mapfile`, no `readlink -f`, no
  `${var,,}`. `layer.sh` runs under `set -euo pipefail`.

## Shell conventions

- The host's `~/.bashrc`, `~/.zshrc`, `~/.zshenv` and `~/.bash_profile` are
  real files with a managed block at the top; the host's own lines below it
  win. The block sources a loader generated into
  `~/.config/dotfiles/build/` (`bashrc`, `zshrc`, `zshenv`).
- The loader sets `$DOTFILES` (this repo), `$DOTFILES_LAYERS`, `$DOTFILES_OS`,
  sources `lib/os.sh`, then runs each stage for every layer (with
  `$DOTFILES_LAYER` set to that layer) before the next stage:
  bash: `os/<os>.sh`, `common/env.sh`, `common/aliases.sh`,
  `common/functions.sh`, legacy `~/.config/shell/local.sh`, `bash/rc.bash`.
  zsh: `zsh/early.zsh` first, then the same, ending with `zsh/rc.zsh`.
- Everything under `shell/common`, `shell/os` must parse in **both bash and
  zsh** (and `lib/os.sh` in plain `sh`). Only bash/zsh-specific settings
  (history, prompt, completion, shopt/setopt) go in the per-shell stages.
- Guard tool-specific aliases with `has_cmd`.
- zsh plugins are submodules under `shell/zsh/plugins/`. `early.zsh` runs
  `git submodule update --init` itself if they're missing (fresh clone without
  `--recursive`) and `rc.zsh` falls back to a plain prompt if that fails.
  Plugins are sourced directly, no plugin manager. Anything that prints or
  reads input must go in `early.zsh` above the p10k instant-prompt block.
- `p10k configure` writes back to `shell/zsh/p10k.zsh` (via
  `POWERLEVEL9K_CONFIG_FILE`); review the diff, it replaces the trimmed file
  with the full generated one.
- In tmux, `ssh-refresh` runs before every prompt (bash `PROMPT_COMMAND`, zsh
  `precmd`) so panes use the ssh agent of whichever client attached last.
- Exported for use anywhere: `$DOTFILES`, `$DOTFILES_LAYERS`, `$DOTFILES_OS`,
  `$DEV` (`~/dev`).

## SSH notes

- `ssh/config` picks the 1Password agent socket (Linux or macOS path) only in
  a local session. Inside an ssh session (`$SSH_CONNECTION` set) it leaves
  `$SSH_AUTH_SOCK`, i.e. the forwarded agent, alone; otherwise the desktop
  1Password app would raise a GUI approval prompt nobody remote can answer.
- ssh takes the first value per option, so host blocks go above the agent
  `Match` blocks. Check resolution with `ssh -G <host>`.

## nvim notes

- Neovim itself is the **nightly** build (distro repos and Homebrew only ship
  releases). `scripts/install-nvim.sh`, run as a setup step, unpacks the
  GitHub `nightly` tarball to `~/.local/opt/nvim-nightly` and links
  `~/.local/bin/nvim`; no sudo. Its check compares `nvim --version` with the
  release notes, so re-running `./setup.sh` updates nvim when a newer nightly
  is out.
- `lua/utils.lua` has `is_linux`, `is_macos`, `pick_by_os({ linux=, macos= })`.
- Modules load through `safety.checked_require`, so one broken module doesn't
  take down the whole config.
- `nvim/nvim-pack-lock.json` is gitignored.

## Verifying changes

There are no tests. Before committing:
- `bash -n` / `zsh -n` on any changed shell files (both shells for shared ones).
- `HOME=$(mktemp -d) ./setup.sh` followed by `./setup.sh -s` gives a full run in
  a sandbox home (`--skip 'step: *'` leaves out the slow steps). Add
  `GSETTINGS_BACKEND=memory` so the terminal steps don't touch the real
  desktop settings; terminal-font checks then always say `todo`, because
  dconf reads its database from `$HOME`. To exercise the macOS route, put a
  stub `uname` that prints `Darwin` for `-s` first on `PATH`.
- Layering: make a throwaway downstream dir with a `setup.sh` that execs this
  one with `--layer` (see the integration guide), give it a few files, run
  it in the sandbox, then run this repo's `./setup.sh` again and check the
  downstream pieces are gone (`-s` shows no `stale`).
- `HOME=<sandbox> bash -ic 'echo $DOTFILES'` and the same with `zsh -ic`
  check that the shells start up.

## Status (2026-10)

Done (branch `dotfiles-overhaul`):
- Removed the Windows tooling (`environment/windows`, VS Code `.bat` copiers,
  nvim `portable_environment`, Windows branches in nvim and VS Code settings).
- Restructured into one repo of linked configs (`setup.sh`, `setup-macos.sh`,
  `lib/link.sh`); superseded by the layered build below.
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
- Ported settings from another dotfiles repo: zsh history/options, completion
  menu, vi-mode key bindings, block cursor, Powerlevel10k + autosuggestions
  (submodules), `ssh-refresh` in tmux, `scratch`, `~/go/bin`, dircolors,
  Nerd Fonts + GNOME Terminal profile scripts, cheat sheet. Not ported on
  purpose: that repo's "append a source line to the distro ~/.bashrc"
  approach (this repo links its own bashrc) and its `MSPECK_TOOLING_PATH`
  (same role as `$DOTFILES`). The layered build later adopted the managed
  block in the host's rc files after all, for host-wins ordering.

Done (branch `layered-build`):
- Layered build: `lib/build.sh` + `layer.sh` replace `lib/link.sh` and the
  two per-OS manifests. Every target gathers from all layers; downstream
  repos plug in with `--layer`; host layer in `~/.config/dotfiles/host/`;
  stale pruning; `docs/integration-guide.md`.
- Shell files split into stages (`shell/bash/rc.bash`, `shell/zsh/early.zsh`,
  `rc.zsh`, `env.zsh`); `shell/init.sh` replaced by generated loaders.

Caveats / open items:
- The layered `setup.sh` has not been run against the real `$HOME` yet; it
  still has the old symlinks. The first run replaces them (shown as `LEGACY`
  by `-s`) with real files holding a managed block, per-item links and
  merged JSON. Exercised on a sandbox copy of that layout.
- Merged JSON (Claude Code, pi, VS Code settings): changes an app saves to a
  key the layers set are reset by the next `./setup.sh` (`-s` shows `DIFF`;
  a backup is kept). Put lasting changes in a layer, or the host layer for
  one machine. Keys the layers don't set are left alone.
- Blocks with copied content (`agents/AGENTS.md`, `ghostty/config`,
  `pi/APPEND_SYSTEM.md`) and generated files need `./setup.sh` after an edit;
  `-s` shows `DIFF` until then. Linked and include-based targets are live.
- Don't put machine-specific config (hardware, local services) in this
  repo; it targets several machines. Exception: the LAN-wide home model
  server in `pi/extensions/home-models.ts` and its search and code-search MCP servers in
  `pi/mcp.json` (key read from 1Password into `$HOME_AI_KEY` by the `pi` shell function).
- `agents/AGENTS.md` is a starter. Grow it with real preferences.
- The macOS path has only been exercised with a stubbed `uname`, never on a
  real Mac.
- Candidates to add later: git config (global gitignore, aliases), other terminal
  configs, `.editorconfig`, rustfmt/ruff/prettier configs under
  `lang/`, a package bootstrap (apt list / Brewfile).
