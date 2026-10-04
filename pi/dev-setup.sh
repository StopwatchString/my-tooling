#!/usr/bin/env bash
# dev-setup.sh — type-checking support for pi/extensions. Not needed to run pi.
#   - links .pi-sdk to the installed pi release's node_modules (types + docs)
#   - installs typescript/@types/node into node_modules on first run
set -euo pipefail

usage() {
  cat <<EOF
Usage: $(basename "$0") [-h|--help]

Prepare pi/ for type-checking its extensions (\`npm run check\` runs this
first). Not needed to run pi; ../setup.sh does the actual wiring.

  - links pi/.pi-sdk to the installed pi release's node_modules
    (\${PI_CODING_AGENT_DIR:-~/.pi/agent}/install/releases/<version>)
  - runs npm install (typescript, @types/node) if pi/node_modules is missing

Safe to re-run; re-run after upgrading pi to repoint .pi-sdk.
EOF
}

case "${1:-}" in
  "")        ;;
  -h|--help) usage; exit 0 ;;
  *)         usage >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

version_file="$AGENT_DIR/install/current-version"
if [ -r "$version_file" ]; then
  ln -sfn "$AGENT_DIR/install/releases/$(cat "$version_file")/node_modules" "$HERE/.pi-sdk"
else
  echo "warning: $version_file not found; .pi-sdk not linked (is pi installed?)" >&2
fi

if [ ! -d "$HERE/node_modules" ]; then
  (cd "$HERE" && npm install --silent --no-audit --no-fund)
fi
