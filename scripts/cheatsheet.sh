#!/usr/bin/env bash
# Print a cheat sheet of what this repo sets up: shell aliases and functions,
# zsh keys, tmux bindings, scripts and linked configs.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

usage() {
  cat <<EOF
Usage: $(basename "$0") [-h|--help]

Print a summary of this repo, read from the repo files themselves so it
stays current: aliases and functions (with their comments), zsh key
bindings, tmux bindings, scripts, and the configs setup.sh links.
Also available as the \`cheat\` alias.
EOF
}

case "${1:-}" in
  "")        ;;
  -h|--help) usage; exit 0 ;;
  *)         usage >&2; exit 2 ;;
esac

if [ -t 1 ]; then B=$'\e[1m' D=$'\e[2m' R=$'\e[0m'; else B='' D='' R=''; fi
section() { printf '\n%s%s%s\n' "$B" "$1" "$R"; }

# Aliases: `alias name='...'` lines, from every shared and per-shell file.
section "Aliases"
for f in shell/common/aliases.sh shell/os/*.sh shell/zsh/zshrc; do
  awk -v f="$f" -v d="$D" -v r="$R" '
    match($0, /alias [A-Za-z0-9_-]+=/) {
      line = substr($0, RSTART + 6); i = index(line, "=")
      printf "  %-16s %s%s  (%s)%s\n", substr(line, 1, i - 1), substr(line, i + 1), d, f, r
    }' "$DOTFILES/$f"
done

# Functions: `name() {` with the first line of the comment block above it.
section "Functions"
awk '
  /^#/ { if (!c) c = substr($0, 3); next }
  /^[A-Za-z0-9_-]+\(\) *\{/ { sub(/\(\).*/, ""); printf "  %-16s %s\n", $0, c }
  { c = "" }' "$DOTFILES/shell/common/functions.sh"

section "zsh keys"
cat <<EOF
  Esc               vi normal mode (bindkey -v, 10ms timeout)
  Up / Down         history search by the typed prefix
  Ctrl-Left/Right   move by word
  Home / End / Del  line start / line end / delete char
  Ctrl-Space        accept autosuggestion
EOF

# tmux: each `# Comment` heading followed by its bind lines' keys.
section "tmux (prefix Ctrl-Space)"
awk '
  /^# ---/ { exit }
  /^# / { h = substr($0, 3); next }
  /^bind / {
    k = $2; if (k == "-r") k = $3
    keys[h] = keys[h] (keys[h] == "" ? "" : " ") k
    if (!(h in seen)) { seen[h] = 1; order[++n] = h }
  }
  END { for (i = 1; i <= n; i++) printf "  %-52s %s\n", order[i], keys[order[i]] }' \
  "$DOTFILES/tmux/.tmux.conf"

# Scripts: name and the first comment line after the shebang.
section "Scripts (not linked; run from the repo)"
for f in "$DOTFILES"/setup.sh "$DOTFILES"/scripts/*.sh "$DOTFILES"/pi/dev-setup.sh; do
  [ -f "$f" ] || continue
  desc="$(sed -n '2s/^# *//p' "$f")"
  printf '  %-34s %s\n' "${f#"$DOTFILES"/}" "${desc#*— }"
done

# Linked configs: the entry lines of setup.sh's manifest.
section "Linked by setup.sh (./setup.sh -s for status)"
awk '$1 == "entry" || $1 == "merge_json" { printf "  %-28s -> %s\n", $2, $3 }' "$DOTFILES/setup.sh"
