#!/usr/bin/env bash
# Refresh the local copies this skill works from: the agent guide, the JSON
# schema, the empty app shell and the gallery sample decks from bento.page.
# Review the diff and commit; the skill itself never goes online.
set -euo pipefail

usage() {
  cat <<EOF
Usage: $(basename "$0") [-h]

Download the current Bento Slides release files from bento.page into this
skill's directory:
  reference/agents.md          agent authoring guide
  reference/slides.schema.json JSON Schema of the #bento-doc document
  app/Bento_Slides.bento.html  the app with an empty #bento-doc block
  samples/<name>.json          gallery decks' documents; embedded fonts are
                               kept, images are replaced by a placeholder
Needs curl, perl and jq.
EOF
}

case ${1-} in
  '') ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

SITE=https://bento.page
GALLERY="orbital-dark-immersive picnic-playful signal-editorial-type terra-premium-product"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch() { echo "fetch $SITE/$1" >&2; curl -fsSL "$SITE/$1" -o "$2"; }

# The document JSON inside a deck's #bento-doc block.
doc_of() { perl -0ne 'print $1 if m{id="bento-doc">(.*?)</script>}s' "$1"; }

fetch agents.md "$tmp/agents.md"
fetch schema/slides.json "$tmp/slides.schema.json"
fetch releases/slides/Bento_Slides.bento.html "$tmp/app.html"
grep -q 'id="bento-doc"' "$tmp/app.html" || { echo "app has no #bento-doc block" >&2; exit 1; }

for name in $GALLERY; do
  fetch "gallery/$name.bento.html" "$tmp/$name.html"
  # Images and media anywhere in the document (doc.assets, element src and
  # poster) become a placeholder; fonts stay so the samples can lend them.
  doc_of "$tmp/$name.html" | jq '
    walk(if type == "string" and startswith("data:") and length > 1024
            and (startswith("data:font/") | not)
         then "OMITTED: \(capture("^data:(?<t>[^;,]*)").t), \(length / 1024 | floor) KB data URI"
         else . end)' > "$tmp/$name.json"
done

mkdir -p "$here/reference" "$here/app" "$here/samples"
mv "$tmp/agents.md" "$tmp/slides.schema.json" "$here/reference/"
mv "$tmp/app.html" "$here/app/Bento_Slides.bento.html"
rm -f "$here/samples/"*.json
for name in $GALLERY; do mv "$tmp/$name.json" "$here/samples/"; done

version="$(sed -n 's/.*Guide version `\([^`]*\)`.*/\1/p' "$here/reference/agents.md" | head -1)"
cat > "$here/reference/SOURCE" <<EOF
Bento Slides $version, fetched from $SITE on $(date +%Y-%m-%d) by update.sh.
EOF
echo "bento-slides: now at $version" >&2
