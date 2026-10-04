# lib/os.sh — OS detection helpers.
#
# POSIX sh so it can be sourced by setup.sh / setup-macos.sh (bash 5 on
# Linux, bash 3.2 on macOS) and by the interactive shell init (bash or zsh).
# Defines functions only; no side effects.

# Prints "linux", "macos", or "unknown".
dotfiles_os() {
  case "$(uname -s)" in
    Linux)  echo linux ;;
    Darwin) echo macos ;;
    *)      echo unknown ;;
  esac
}

is_linux() { [ "$(dotfiles_os)" = linux ]; }
is_macos() { [ "$(dotfiles_os)" = macos ]; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }
