#!/usr/bin/env bash
# setup-macos.sh — macOS counterpart to setup.sh, which hands off to it.
#
# Runs under macOS's /bin/bash 3.2: no associative arrays, no mapfile, no
# `readlink -f`. Linking logic lives in lib/link.sh.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
. "$DOTFILES/lib/os.sh"

if ! is_macos; then
  echo "error: setup-macos.sh is for macOS; use setup.sh" >&2
  exit 1
fi

. "$DOTFILES/lib/link.sh"

# Check and apply functions for the setup steps that aren't files (see `step`
# in lib/link.sh). A submodule line starting with '-' isn't checked out yet.
submodules_ok() {
  local s
  s="$(git -C "$DOTFILES" submodule status)" || return 1
  [[ $s != -* && $s != *$'\n-'* ]]
}
submodules_init() { git -C "$DOTFILES" submodule update --init --depth 1; }
fonts_ok()        { "$DOTFILES/scripts/install-fonts.sh" --check; }
fonts_install()   { "$DOTFILES/scripts/install-fonts.sh"; }
nvim_ok()         { "$DOTFILES/scripts/install-nvim.sh" --check; }
nvim_install()    { "$DOTFILES/scripts/install-nvim.sh"; }

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
APP_SUPPORT="$HOME/Library/Application Support"

manifest() {
  # Shells
  entry shell/bash/bashrc         "$HOME/.bashrc"
  entry shell/bash/bash_profile   "$HOME/.bash_profile"
  entry shell/zsh/zshrc           "$HOME/.zshrc"
  entry shell/zsh/zshenv          "$HOME/.zshenv"

  # Terminal / editors (nvim uses ~/.config on macOS too)
  entry tmux/.tmux.conf           "$HOME/.tmux.conf"
  entry nvim                      "$CONFIG_HOME/nvim"
  entry ghostty/config            "$CONFIG_HOME/ghostty/config"
  entry vscode/settings.json      "$APP_SUPPORT/Code/User/settings.json"
  entry vscode/keybindings.json   "$APP_SUPPORT/Code/User/keybindings.json"

  # SSH (machine-specific bits go in the untracked ~/.ssh/config.local)
  entry ssh/config                "$HOME/.ssh/config"

  # Language tooling
  entry lang/clang/.clang-format  "$HOME/.clang-format"
  entry lang/clangd/config.yaml   "$HOME/Library/Preferences/clangd/config.yaml"

  # Coding agents (one shared global instructions file)
  entry agents/AGENTS.md          "$HOME/.claude/CLAUDE.md"
  entry claude/settings.json      "$HOME/.claude/settings.json"

  # Shared agent skills (ai/skills/<name>/SKILL.md). pi reads the whole dir as
  # ~/.agents/skills. Claude Code keeps its own synced/ dir in ~/.claude/skills,
  # so each skill is linked there one by one.
  entry ai/skills                 "$HOME/.agents/skills"
  local skill
  for skill in "$DOTFILES"/ai/skills/*/; do
    [[ -d $skill ]] || continue
    skill="${skill%/}"; skill="${skill##*/}"
    entry "ai/skills/$skill"      "$HOME/.claude/skills/$skill"
  done

  # pi (see pi/README.md). settings.json is rewritten by pi, so it's merged;
  # the filter drops the package entry of the retired ~/dev/pi-harness repo.
  local pi_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  entry agents/AGENTS.md          "$pi_dir/AGENTS.md"
  entry pi/APPEND_SYSTEM.md       "$pi_dir/APPEND_SYSTEM.md"
  entry pi/keybindings.json       "$pi_dir/keybindings.json"
  entry pi/mcp.json               "$pi_dir/mcp.json"
  entry pi/extensions             "$pi_dir/extensions"
  entry pi/agents                 "$pi_dir/agents"
  entry pi/skills                 "$pi_dir/skills"
  entry pi/prompts                "$pi_dir/prompts"
  entry pi/themes                 "$pi_dir/themes"
  merge_json pi/settings.json     "$pi_dir/settings.json" \
    'if .packages then .packages |= map(select(tostring | test("pi-harness") | not))
       | if .packages == [] then del(.packages) else . end else . end'

  # Not files: plugins, fonts, Neovim nightly
  step "zsh plugin submodules"      submodules_ok submodules_init
  step "fonts"                      fonts_ok      fonts_install
  step "Neovim nightly"             nvim_ok       nvim_install
}

link_main "$@"
