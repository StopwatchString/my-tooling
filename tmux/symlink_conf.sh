#!/usr/bin/env bash
set -euo pipefail

# Name of the config file in the repo (change if yours differs, e.g. "tmux.conf")
CONF_NAME=".tmux.conf"

# Absolute path of the directory containing this script, symlinks resolved
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SRC="$SCRIPT_DIR/$CONF_NAME"
DEST="$HOME/.tmux.conf"

if [[ ! -f "$SRC" ]]; then
  echo "error: $SRC not found" >&2
  exit 1
fi

if [[ -L "$DEST" ]]; then
  current="$(readlink "$DEST")"
  if [[ "$current" == "$SRC" ]]; then
    echo "already linked: $DEST -> $SRC"
    exit 0
  fi
  echo "replacing existing symlink: $DEST -> $current"
  rm "$DEST"
elif [[ -e "$DEST" ]]; then
  backup="$DEST.backup.$(date +%Y%m%d%H%M%S)"
  mv "$DEST" "$backup"
  echo "backed up existing file to $backup"
fi

ln -s "$SRC" "$DEST"
echo "linked: $DEST -> $SRC"
