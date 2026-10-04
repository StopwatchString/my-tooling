# Functions shared by bash and zsh.

# Symlink a file into /usr/local/bin.
symlink-binary() {
  if [ $# -ne 1 ]; then
    echo "usage: symlink-binary <file>" >&2
    return 1
  fi
  local src
  src="$(realpath "$1")" || return 1
  if [ ! -f "$src" ]; then
    echo "not a file: $src" >&2
    return 1
  fi
  sudo ln -s "$src" "/usr/local/bin/$(basename "$src")"
}

# Find and (optionally) remove dangling symlinks in /usr/local/bin.
prune-binaries() {
  local dir=/usr/local/bin
  local dead
  dead="$(find "$dir" -maxdepth 1 -type l ! -exec test -e {} \; -print)"
  if [ -z "$dead" ]; then
    echo "no dead symlinks in $dir"
    return 0
  fi
  echo "dead symlinks:"
  echo "$dead"
  printf "remove these? [y/N] "
  read -r reply
  case "$reply" in
    [yY]*) sudo find "$dir" -maxdepth 1 -type l ! -exec test -e {} \; -exec rm -- {} \; -print ;;
    *) echo "aborted" ;;
  esac
}

# pi with the home model server's key pulled from 1Password into the env for
# that run only (pi/extensions/home-models.ts reads $HOME_AI_KEY). Skipped when
# HOME_AI_KEY is already set or `op` isn't installed (socrates itself needs no key).
# Override the item with HOME_AI_KEY_REF in ~/.config/shell/local.sh.
pi() {
  if [ -z "${HOME_AI_KEY:-}" ] && has_cmd op; then
    local key
    if key="$(op read "${HOME_AI_KEY_REF:-op://Personal/home-ai-server/credential}" 2>/dev/null)"; then
      HOME_AI_KEY="$key" command pi "$@"
      return
    fi
    echo "pi: couldn't read the home-ai-server key from 1Password (op signin?); home models will fail" >&2
  fi
  command pi "$@"
}
