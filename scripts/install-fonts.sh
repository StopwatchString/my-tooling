#!/usr/bin/env bash
# Install the fonts in fonts/ for the current user and make UbuntuMono Nerd
# Font Mono the GNOME Terminal / Ptyxis font.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
. "$DOTFILES/lib/os.sh"

FONT_NAME='UbuntuMono Nerd Font Mono 13'

usage() {
  cat <<EOF
Usage: $(basename "$0") [--check] [-h|--help]

Copy the .ttf files in fonts/ to the user font directory
(~/.local/share/fonts on Linux, ~/Library/Fonts on macOS) and refresh the
font cache. Set the font of GNOME Terminal's default profile and of Ptyxis,
whichever are installed, to "$FONT_NAME". Safe to re-run.
setup.sh runs this as one of its steps.

  --check   Change nothing; exit 0 if everything is already in place, 1 if
            not, listing what's missing.

The rest of the GNOME Terminal profile (colors, bell) is applied by
scripts/gnome-terminal-profile.sh load.
EOF
}

check=0
case "${1:-}" in
  "")        ;;
  --check)   check=1 ;;
  -h|--help) usage; exit 0 ;;
  *)         usage >&2; exit 2 ;;
esac

if is_macos; then
  dest="$HOME/Library/Fonts"
else
  dest="${XDG_DATA_HOME:-$HOME/.local/share}/fonts"
fi

schemas="$(has_cmd gsettings && gsettings list-schemas 2>/dev/null || true)"
has_schema() { grep -qx "$1" <<<"$schemas"; }
gt_path() {
  echo "/org/gnome/terminal/legacy/profiles:/:$(gsettings get org.gnome.Terminal.ProfilesList default | tr -d "'")/"
}

if (( check )); then
  missing=0
  for f in "$DOTFILES"/fonts/*.ttf; do
    if ! cmp -s "$f" "$dest/$(basename "$f")"; then
      echo "not installed: $(basename "$f")"; missing=1
    fi
  done
  if has_schema org.gnome.Terminal.ProfilesList; then
    path="$(gt_path)"
    if [[ "$(dconf read "${path}font")" != "'$FONT_NAME'" ||
          "$(dconf read "${path}use-system-font")" != false ]]; then
      echo "GNOME Terminal font isn't $FONT_NAME"; missing=1
    fi
  fi
  if has_schema org.gnome.Ptyxis; then
    if [[ "$(gsettings get org.gnome.Ptyxis font-name)" != "'$FONT_NAME'" ||
          "$(gsettings get org.gnome.Ptyxis use-system-font)" != false ]]; then
      echo "Ptyxis font isn't $FONT_NAME"; missing=1
    fi
  fi
  exit "$missing"
fi

mkdir -p "$dest"
cp "$DOTFILES"/fonts/*.ttf "$dest/"
echo "installed fonts to $dest"
if has_cmd fc-cache; then
  fc-cache -f "$dest"
fi

terminals=0

if has_schema org.gnome.Terminal.ProfilesList; then
  path="$(gt_path)"
  dconf write "${path}use-system-font" false
  dconf write "${path}font" "'$FONT_NAME'"
  echo "GNOME Terminal font set to $FONT_NAME"
  terminals=$((terminals + 1))
fi

# Ptyxis (Ubuntu's default terminal from 25.10) keeps one app-wide font.
if has_schema org.gnome.Ptyxis; then
  gsettings set org.gnome.Ptyxis use-system-font false
  gsettings set org.gnome.Ptyxis font-name "$FONT_NAME"
  echo "Ptyxis font set to $FONT_NAME"
  terminals=$((terminals + 1))
fi

if (( terminals == 0 )); then
  echo "no GNOME Terminal or Ptyxis found; set the terminal font to $FONT_NAME by hand"
fi
