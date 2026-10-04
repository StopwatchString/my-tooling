#!/usr/bin/env bash
# setup.sh — symlink every config in this repo into place.
#
# Linux is the primary target and is handled here. On macOS this hands off to
# setup-macos.sh, which has its own manifest. Linking logic lives in lib/link.sh.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
. "$DOTFILES/lib/os.sh"

case "$(dotfiles_os)" in
  linux) ;;
  macos) exec "$DOTFILES/setup-macos.sh" "$@" ;;
  *)     echo "error: unsupported OS '$(uname -s)'" >&2; exit 1 ;;
esac

. "$DOTFILES/lib/link.sh"

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

# One `entry <path in repo> <destination>` per managed link. Add new configs
# here, and in setup-macos.sh if they apply there too.
manifest() {
  # Shells
  entry shell/bash/bashrc         "$HOME/.bashrc"
  entry shell/bash/bash_profile   "$HOME/.bash_profile"
  entry shell/zsh/zshrc           "$HOME/.zshrc"

  # Terminal / editors
  entry tmux/.tmux.conf           "$HOME/.tmux.conf"
  entry nvim                      "$CONFIG_HOME/nvim"
  entry vscode/settings.json      "$CONFIG_HOME/Code/User/settings.json"
  entry vscode/keybindings.json   "$CONFIG_HOME/Code/User/keybindings.json"

  # Language tooling
  entry lang/clang/.clang-format  "$HOME/.clang-format"
  entry lang/clangd/config.yaml   "$CONFIG_HOME/clangd/config.yaml"

  # Coding agents (one shared global instructions file)
  entry agents/AGENTS.md          "$HOME/.claude/CLAUDE.md"
  entry claude/settings.json      "$HOME/.claude/settings.json"
  entry agents/AGENTS.md          "$HOME/.pi/agent/AGENTS.md"
  entry pi/settings.json          "$HOME/.pi/agent/settings.json"
}

link_main "$@"
