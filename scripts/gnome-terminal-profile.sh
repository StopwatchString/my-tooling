#!/usr/bin/env bash
# Sync GNOME Terminal's default profile with gnome-terminal/profile.dconf.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PROFILE_FILE="$DOTFILES/gnome-terminal/profile.dconf"

usage() {
  cat <<EOF
Usage: $(basename "$0") load|export|check

  load    Apply gnome-terminal/profile.dconf to GNOME Terminal's default
          profile. Keys not in the file are left alone. Safe to re-run.
  export  Dump the default profile back into gnome-terminal/profile.dconf,
          after changing it in GNOME Terminal's preferences.
  check   Exit 0 if the default profile already has every setting in the
          file (or GNOME Terminal isn't installed), 1 if not. setup.sh
          uses this to decide whether to run load.
EOF
}

case "${1:-}" in
  load|export|check) ;;
  -h|--help)   usage; exit 0 ;;
  *)           usage >&2; exit 2 ;;
esac

schemas="$(command -v gsettings >/dev/null && gsettings list-schemas 2>/dev/null || true)"
if ! grep -qx org.gnome.Terminal.ProfilesList <<<"$schemas"; then
  [[ $1 == check ]] && exit 0
  echo "error: GNOME Terminal isn't installed (no org.gnome.Terminal schema)" >&2
  exit 1
fi

uuid="$(gsettings get org.gnome.Terminal.ProfilesList default | tr -d "'")"
path="/org/gnome/terminal/legacy/profiles:/:$uuid/"

case "$1" in
  load)
    dconf load "$path" < "$PROFILE_FILE"
    echo "loaded $PROFILE_FILE into profile $uuid"
    ;;
  check)
    current="$(dconf dump "$path")"
    while IFS= read -r line; do
      [[ -z $line || $line == '[/]' ]] && continue
      grep -qxF -- "$line" <<<"$current" || { echo "differs: ${line%%=*}"; exit 1; }
    done < "$PROFILE_FILE"
    ;;
  export)
    dconf dump "$path" > "$PROFILE_FILE"
    echo "exported profile $uuid to $PROFILE_FILE"
    ;;
esac
