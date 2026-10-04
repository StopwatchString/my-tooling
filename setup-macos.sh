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

  # Terminal / editors (nvim uses ~/.config on macOS too)
  entry tmux/.tmux.conf           "$HOME/.tmux.conf"
  entry nvim                      "$CONFIG_HOME/nvim"
  entry vscode/settings.json      "$APP_SUPPORT/Code/User/settings.json"
  entry vscode/keybindings.json   "$APP_SUPPORT/Code/User/keybindings.json"

  # Language tooling
  entry lang/clang/.clang-format  "$HOME/.clang-format"
  entry lang/clangd/config.yaml   "$HOME/Library/Preferences/clangd/config.yaml"

  # Coding agents (one shared global instructions file)
  entry agents/AGENTS.md          "$HOME/.claude/CLAUDE.md"
  entry claude/settings.json      "$HOME/.claude/settings.json"
  entry agents/AGENTS.md          "$HOME/.pi/agent/AGENTS.md"
  entry pi/settings.json          "$HOME/.pi/agent/settings.json"
}

link_main "$@"
