# lib/link.sh — symlink engine shared by setup.sh (Linux) and setup-macos.sh.
#
# The sourcing script sets $DOTFILES, defines manifest() as a list of
# `entry <path in repo> <destination>` calls (and `merge_json` for configs an
# app rewrites itself), then runs `link_main "$@"`.
# Must stay compatible with bash 3.2 (macOS /bin/bash): no associative arrays,
# no mapfile, no `readlink -f`.

STAMP="$(date +%Y%m%d%H%M%S)"
MODE=install
changes=0
problems=0

link_usage() {
  cat <<EOF
Usage: $(basename "$0") [option]

Symlink this repo's configs into \$HOME. A few JSON configs that their app
rewrites itself (pi's settings.json) are merged into the live file instead.

  (none)        Create or refresh everything. Existing files are moved to
                <name>.backup.<timestamp>; existing symlinks are replaced.
                Merged files are backed up the same way before they change.
                Safe to re-run.
  -n, --dry-run Print what would change (link, relink, backup, merge)
                without touching anything.
  -s, --status  Show the state of every managed path:
                  ok      linked into this repo (or merged and up to date)
                  absent  not set up yet
                  FILE    a real file is in the way (will be backed up)
                  OTHER   a symlink pointing somewhere else (will be replaced)
                  DIFF    a merged file has drifted from the repo values
  -u, --uninstall
                Remove managed symlinks that point into this repo. Backups
                and merged files are left in place.
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

# merge_json <path in repo> <destination> [jq filter]
# For JSON configs that their app rewrites itself, so a symlink would be
# replaced or dirty the repo. The repo file's top-level keys are merged over the
# live file (repo wins, other keys are kept), then the optional jq filter runs
# on the result (e.g. to drop stale entries). Needs jq.
merge_json() {
  local src="$DOTFILES/$1" dest="$2" filter="${3:-.}" current live merged
  if [[ ! -e $src ]]; then
    say MISSING "$1 (not in repo)"; problems=$((problems + 1)); return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    say NO-JQ "$dest (jq is needed to merge $1)"; problems=$((problems + 1)); return
  fi
  current="$(link_target "$dest")"

  # A symlink here (left by an older setup) is read through, then replaced.
  if [[ -e $dest ]]; then
    live="$(jq . "$dest")" || {
      say BAD "$dest (not valid JSON)"; problems=$((problems + 1)); return; }
  else
    live='{}'
  fi
  merged="$(printf '%s\n' "$live" | jq --slurpfile want "$src" "(. + \$want[0]) | $filter")" || {
    say BAD "$1 (merge failed)"; problems=$((problems + 1)); return; }

  case $MODE in
    status)
      if [[ -n $current ]]; then say LINKED "$dest -> $current (should be a merged file)"
      elif [[ ! -e $dest ]]; then say absent "$dest"
      elif [[ $live == "$merged" ]]; then say ok "$dest (merged)"
      else say DIFF "$dest (differs from $1)"
      fi
      ;;

    uninstall)
      if [[ $current == "$src" ]]; then
        rm "$dest"; say removed "$dest"; changes=$((changes + 1))
      fi
      ;;

    install|dry-run)
      if [[ -z $current && -e $dest && $live == "$merged" ]]; then
        return
      fi
      run mkdir -p "$(dirname "$dest")"
      if [[ -n $current ]]; then
        say unlink "$dest (was -> $current)"
        run rm "$dest"
      elif [[ -e $dest ]]; then
        say backup "$dest -> $dest.backup.$STAMP"
        run cp -p "$dest" "$dest.backup.$STAMP"
      fi
      if [[ $MODE == install ]]; then
        printf '%s\n' "$merged" > "$dest.tmp.$$" && mv "$dest.tmp.$$" "$dest"
      fi
      say merge "$dest <- $1"
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
