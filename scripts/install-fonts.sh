#!/usr/bin/env bash
# Install the fonts in fonts/ for the current user and make UbuntuMono Nerd
# Font Mono the GNOME Terminal font.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
. "$DOTFILES/lib/os.sh"

FONT_NAME='UbuntuMono Nerd Font Mono 13'

usage() {
  cat <<EOF
Usage: $(basename "$0") [-h|--help]

Copy the .ttf files in fonts/ to the user font directory
(~/.local/share/fonts on Linux, ~/Library/Fonts on macOS) and refresh the
font cache. If GNOME Terminal is installed, set its default profile's font
to "$FONT_NAME". Safe to re-run.

The rest of the terminal profile (colors, bell) is applied by
scripts/gnome-terminal-profile.sh load.
EOF
}

case "${1:-}" in
  "")        ;;
  -h|--help) usage; exit 0 ;;
  *)         usage >&2; exit 2 ;;
esac

if is_macos; then
  dest="$HOME/Library/Fonts"
else
  dest="${XDG_DATA_HOME:-$HOME/.local/share}/fonts"
fi
mkdir -p "$dest"
cp "$DOTFILES"/fonts/*.ttf "$dest/"
echo "installed fonts to $dest"
if has_cmd fc-cache; then
  fc-cache -f "$dest"
fi

if has_cmd gsettings && gsettings list-schemas 2>/dev/null | grep -qx org.gnome.Terminal.ProfilesList; then
  uuid="$(gsettings get org.gnome.Terminal.ProfilesList default | tr -d "'")"
  path="/org/gnome/terminal/legacy/profiles:/:$uuid/"
  dconf write "${path}use-system-font" false
  dconf write "${path}font" "'$FONT_NAME'"
  echo "GNOME Terminal font set to $FONT_NAME"
else
  echo "GNOME Terminal not found; set the terminal font to $FONT_NAME by hand"
fi
