# lib/link.sh — symlink engine shared by setup.sh (Linux) and setup-macos.sh.
#
# The sourcing script sets $DOTFILES, defines manifest() as a list of
# `entry <path in repo> <destination>` calls, then runs `link_main "$@"`.
# Must stay compatible with bash 3.2 (macOS /bin/bash): no associative arrays,
# no mapfile, no `readlink -f`.

STAMP="$(date +%Y%m%d%H%M%S)"
MODE=install
changes=0
problems=0

link_usage() {
  cat <<EOF
Usage: $(basename "$0") [option]

  (none)        Create or refresh all symlinks. Existing files are moved to
                <name>.backup.<timestamp>; existing symlinks are replaced.
  -n, --dry-run Show what would change without touching anything.
  -s, --status  Show the state of every managed link.
  -u, --uninstall
                Remove managed symlinks that point into this repo. Backups
                are left in place.
  -h, --help    Show this help.
EOF
}

say() { printf '  %-8s %s\n' "$1" "$2"; }
run() { if [[ $MODE == dry-run ]]; then :; else "$@"; fi; }

# Print the target of a symlink (one level), or nothing.
link_target() { [[ -L $1 ]] && readlink "$1" || true; }

entry() {
  local src="$DOTFILES/$1" dest="$2" current
  if [[ ! -e $src ]]; then
    say MISSING "$1 (not in repo)"; problems=$((problems + 1)); return
  fi
  current="$(link_target "$dest")"

  case $MODE in
    status)
      if [[ $current == "$src" ]]; then say ok "$dest"
      elif [[ -n $current ]]; then say OTHER "$dest -> $current"
      elif [[ -e $dest ]]; then say FILE "$dest (not linked)"
      else say absent "$dest"
      fi
      ;;

    uninstall)
      if [[ $current == "$src" ]]; then
        rm "$dest"; say removed "$dest"; changes=$((changes + 1))
      fi
      ;;

    install|dry-run)
      if [[ $current == "$src" ]]; then
        return
      fi
      run mkdir -p "$(dirname "$dest")"
      if [[ -n $current ]]; then
        say relink "$dest (was -> $current)"
        run rm "$dest"
      elif [[ -e $dest ]]; then
        say backup "$dest -> $dest.backup.$STAMP"
        run mv "$dest" "$dest.backup.$STAMP"
      fi
      run ln -s "$src" "$dest"
      say link "$dest -> $src"
      changes=$((changes + 1))
      ;;
  esac
}

link_main() {
  case "${1:-}" in
    "")              MODE=install ;;
    -n|--dry-run)    MODE=dry-run ;;
    -s|--status)     MODE=status ;;
    -u|--uninstall)  MODE=uninstall ;;
    -h|--help)       link_usage; exit 0 ;;
    *)               link_usage >&2; exit 2 ;;
  esac

  echo "dotfiles: $DOTFILES ($(basename "$0"), $MODE)"
  manifest

  case $MODE in
    install)   echo "$changes link(s) changed." ;;
    dry-run)   echo "$changes link(s) would change." ;;
    uninstall) echo "$changes link(s) removed." ;;
  esac
  (( problems == 0 )) || { echo "$problems problem(s)." >&2; exit 1; }
}
