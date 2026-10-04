# shell/init.sh — shared interactive-shell setup for bash and zsh.
#
# Sourced by shell/bash/bashrc and shell/zsh/zshrc after they set $DOTFILES.
# Everything sourced from here must parse in both bash and zsh.

. "$DOTFILES/lib/os.sh"
DOTFILES_OS="$(dotfiles_os)"
export DOTFILES DOTFILES_OS

# OS file first: on macOS it puts Homebrew on PATH, which env.sh relies on.
[ -f "$DOTFILES/shell/os/$DOTFILES_OS.sh" ] && . "$DOTFILES/shell/os/$DOTFILES_OS.sh"
. "$DOTFILES/shell/common/env.sh"
. "$DOTFILES/shell/common/aliases.sh"
. "$DOTFILES/shell/common/functions.sh"

# Machine-specific, untracked overrides (secrets, work paths, ...).
[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/shell/local.sh" ] && . "${XDG_CONFIG_HOME:-$HOME/.config}/shell/local.sh"
