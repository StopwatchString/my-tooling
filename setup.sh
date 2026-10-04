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
  entry shell/zsh/zshenv          "$HOME/.zshenv"

  # Terminal / editors
  entry tmux/.tmux.conf           "$HOME/.tmux.conf"
  entry nvim                      "$CONFIG_HOME/nvim"
  entry vscode/settings.json      "$CONFIG_HOME/Code/User/settings.json"
  entry vscode/keybindings.json   "$CONFIG_HOME/Code/User/keybindings.json"

  # SSH (machine-specific bits go in the untracked ~/.ssh/config.local)
  entry ssh/config                "$HOME/.ssh/config"

  # Language tooling
  entry lang/clang/.clang-format  "$HOME/.clang-format"
  entry lang/clangd/config.yaml   "$CONFIG_HOME/clangd/config.yaml"

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
