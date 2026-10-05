#!/usr/bin/env bash
# Install or update the Neovim nightly build for the current user. Distro
# packages and Homebrew only carry releases, so this pulls the prebuilt
# tarball from the GitHub "nightly" release. setup.sh runs this as a step.
# Runs under bash 3.2 too (macOS /bin/bash).
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
. "$DOTFILES/lib/os.sh"

PREFIX="${NVIM_NIGHTLY_PREFIX:-$HOME/.local/opt/nvim-nightly}"
BIN="$HOME/.local/bin/nvim"
API=https://api.github.com/repos/neovim/neovim/releases/tags/nightly
DL=https://github.com/neovim/neovim/releases/download/nightly

usage() {
  cat <<EOF
Usage: $(basename "$0") [--check] [-h|--help]

Download the latest Neovim nightly for this OS and CPU, unpack it to
$PREFIX (replacing any previous copy) and symlink
$BIN to it. No sudo needed. Does nothing when the installed
build already is the latest nightly. setup.sh runs this as one of its steps,
so re-running ./setup.sh keeps nvim up to date.

  --check   Change nothing; exit 0 if the latest nightly is installed, 1 if
            not. When GitHub can't be reached, an existing install counts
            as up to date.

Set NVIM_NIGHTLY_PREFIX to install somewhere else.
EOF
}

check=0
case "${1:-}" in
  "")        ;;
  --check)   check=1 ;;
  -h|--help) usage; exit 0 ;;
  *)         usage >&2; exit 2 ;;
esac

case "$(dotfiles_os)/$(uname -m)" in
  linux/x86_64)              asset=nvim-linux-x86_64 ;;
  linux/aarch64|linux/arm64) asset=nvim-linux-arm64 ;;
  macos/x86_64)              asset=nvim-macos-x86_64 ;;
  macos/arm64)               asset=nvim-macos-arm64 ;;
  *) echo "error: no nightly build for $(uname -s)/$(uname -m)" >&2; exit 1 ;;
esac

# First line of `nvim --version`, e.g. "NVIM v0.13.0-dev-1808+g561857c4a8".
installed() { [ -x "$PREFIX/bin/nvim" ] && "$PREFIX/bin/nvim" --version 2>/dev/null | head -1; }
# The release notes start with the same line for the published build.
latest() { curl -fsSL --max-time 20 "$API" | grep -o 'NVIM v[0-9A-Za-z.+-]*' | head -1; }

have="$(installed || true)"
want="$(latest || true)"
linked=0
[ "$(readlink "$BIN" 2>/dev/null || true)" = "$PREFIX/bin/nvim" ] && linked=1

if [ -z "$want" ]; then
  if [ -n "$have" ] && (( linked )); then
    echo "warning: can't reach GitHub; keeping $have" >&2
    exit 0
  fi
  (( check )) && { echo "not installed: nvim nightly (GitHub unreachable)"; exit 1; }
  echo "error: can't get the nightly version from GitHub" >&2; exit 1
fi

if [ "$have" = "$want" ] && (( linked )); then
  (( check )) || echo "up to date: $have"
  exit 0
fi
if (( check )); then
  echo "installed: ${have:-none}, latest: $want"
  [ "$have" = "$want" ] || exit 1
  echo "not linked: $BIN"; exit 1
fi

if [ "$have" != "$want" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "downloading $asset.tar.gz ($want)"
  curl -fL --progress-bar -o "$tmp/nvim.tar.gz" "$DL/$asset.tar.gz"
  tar -C "$tmp" -xzf "$tmp/nvim.tar.gz"
  "$tmp/$asset/bin/nvim" --version >/dev/null   # refuse a broken build
  mkdir -p "$(dirname "$PREFIX")"
  rm -rf "$PREFIX.old"
  [ -e "$PREFIX" ] && mv "$PREFIX" "$PREFIX.old"
  mv "$tmp/$asset" "$PREFIX"
  rm -rf "$PREFIX.old"
fi

mkdir -p "$(dirname "$BIN")"
ln -sfn "$PREFIX/bin/nvim" "$BIN"
echo "installed: $("$BIN" --version | head -1) -> $BIN"
