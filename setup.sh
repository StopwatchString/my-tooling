#!/usr/bin/env bash
# setup.sh — build this machine's configs from this repo and any layers on top.
#
# Run on its own, this repo is the only (last) layer. Downstream repos run
# their own setup.sh, which execs this one with `--layer <their dir>` (see
# docs/integration-guide.md). The engine is lib/build.sh; this repo's targets
# are in layer.sh. Linux and macOS; must run under bash 3.2.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
. "$DOTFILES/lib/os.sh"

case "$(dotfiles_os)" in
  linux|macos) ;;
  *) echo "error: unsupported OS '$(uname -s)'" >&2; exit 1 ;;
esac

. "$DOTFILES/lib/build.sh"
build_main "$@"
