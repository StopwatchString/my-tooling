#!/usr/bin/env bash
# Print a cheat sheet of what the dotfiles set up: shell aliases and functions,
# zsh keys, tmux bindings, scripts and managed configs, across all layers.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# Layers from the shell loader (this repo alone when run outside it).
IFS=: read -r -a LAYERS <<< "${DOTFILES_LAYERS:-$DOTFILES}"
RECORD="${XDG_CONFIG_HOME:-$HOME/.config}/dotfiles/build/managed"

usage() {
  cat <<EOF
Usage: $(basename "$0") [-h|--help]

Print a summary of the dotfiles, read from the layer files themselves so it
stays current: aliases and functions (with their comments), zsh key
bindings, tmux bindings, scripts, and the configs setup.sh manages. Covers
every layer in \$DOTFILES_LAYERS (set by the shell setup).
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
for l in "${LAYERS[@]}"; do
for f in "$l"/shell/common/aliases.sh "$l"/shell/os/*.sh "$l"/shell/zsh/rc.zsh "$l"/shell/bash/rc.bash; do
  [ -f "$f" ] || continue
  awk -v f="$(basename "$l")/${f#"$l"/}" -v d="$D" -v r="$R" '
    match($0, /alias [A-Za-z0-9_-]+=/) {
      line = substr($0, RSTART + 6); i = index(line, "=")
      printf "  %-16s %s%s  (%s)%s\n", substr(line, 1, i - 1), substr(line, i + 1), d, f, r
    }' "$f"
done
done

# Functions: `name() {` with the first line of the comment block above it.
section "Functions"
for l in "${LAYERS[@]}"; do
[ -f "$l/shell/common/functions.sh" ] || continue
awk '
  /^#/ { if (!c) c = substr($0, 3); next }
  /^[A-Za-z0-9_-]+\(\) *\{/ { sub(/\(\).*/, ""); printf "  %-16s %s\n", $0, c }
  { c = "" }' "$l/shell/common/functions.sh"
done

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
for l in "${LAYERS[@]}"; do
[ -f "$l/tmux/tmux.conf" ] || continue
awk '
  /^# ---/ { exit }
  /^# / { h = substr($0, 3); next }
  /^bind / {
    k = $2; if (k == "-r") k = $3
    keys[h] = keys[h] (keys[h] == "" ? "" : " ") k
    if (!(h in seen)) { seen[h] = 1; order[++n] = h }
  }
  END { for (i = 1; i <= n; i++) printf "  %-52s %s\n", order[i], keys[order[i]] }' \
  "$l/tmux/tmux.conf"
done

# Scripts: name and the first comment line after the shebang.
section "Scripts (not linked; run from their repo)"
for l in "${LAYERS[@]}"; do
for f in "$l"/setup.sh "$l"/scripts/*.sh "$l"/pi/dev-setup.sh; do
  [ -f "$f" ] || continue
  desc="$(sed -n '2s/^# *//p' "$f")"
  printf '  %-34s %s\n' "$(basename "$l")/${f#"$l"/}" "${desc#*— }"
done
done

# Managed configs: what the last setup run recorded.
section "Managed by setup.sh (./setup.sh -s for status)"
if [ -f "$RECORD" ]; then
  awk -F'\t' -v h="$HOME" '{ d = $2; if (index(d, h) == 1) d = "~" substr(d, length(h) + 1)
    k = $1; sub(/:.*/, "", k); printf "  %-6s %s\n", k, d }' "$RECORD"
else
  echo "  (setup.sh hasn't run yet)"
fi
