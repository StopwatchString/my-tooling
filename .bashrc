alias update='sudo apt update && sudo apt upgrade && sudo apt autoremove'
alias update-firmware='sudo fwupdmgr refresh && sudo fwupdmgr update'
alias update-nix='sudo determinate-nixd upgrade'

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
