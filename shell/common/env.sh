# Environment shared by bash and zsh.

# path_prepend DIR: put DIR at the front of PATH if it exists and isn't already there.
path_prepend() {
  [ -d "$1" ] || return 0
  case ":$PATH:" in
    *":$1:"*) ;;
    *) PATH="$1:$PATH" ;;
  esac
}

path_prepend "$HOME/go/bin"
path_prepend "$HOME/.local/bin"
export PATH

# Rust toolchain (rustup). Also in zsh/zshenv for non-interactive zsh.
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

if has_cmd nvim; then
  export EDITOR=nvim VISUAL=nvim
fi

export DEV="$HOME/dev"
