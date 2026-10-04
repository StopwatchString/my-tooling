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

  # pi (see pi/README.md). settings.json is rewritten by pi, so it's merged;
  # the filter drops the package entry of the retired ~/dev/pi-harness repo.
  local pi_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  entry agents/AGENTS.md          "$pi_dir/AGENTS.md"
  entry pi/APPEND_SYSTEM.md       "$pi_dir/APPEND_SYSTEM.md"
  entry pi/keybindings.json       "$pi_dir/keybindings.json"
  entry pi/mcp.json               "$pi_dir/mcp.json"
  entry pi/extensions             "$pi_dir/extensions"
  entry pi/skills                 "$pi_dir/skills"
  entry pi/prompts                "$pi_dir/prompts"
  entry pi/themes                 "$pi_dir/themes"
  merge_json pi/settings.json     "$pi_dir/settings.json" \
    'if .packages then .packages |= map(select(tostring | test("pi-harness") | not))
       | if .packages == [] then del(.packages) else . end else . end'
}

link_main "$@"
