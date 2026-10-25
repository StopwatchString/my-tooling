#!/bin/sh
# Fetch the pinned tree-sitter files listed in ./manifest into this directory,
# checking each against its sha256. Run by hand when adding or re-pinning a
# file; pi itself never fetches anything (it reads the checked-in copies).
#
#   ./fetch.sh          fetch every file that is missing or doesn't match
#   ./fetch.sh --check  only check the files here against the manifest (no network)
#
# POSIX sh, so it runs the same under bash and zsh (`sh fetch.sh`).
set -eu

usage() {
	sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
}

check_only=0
case "${1-}" in
	"") ;;
	--check) check_only=1 ;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		echo "fetch.sh: unknown argument: $1" >&2
		usage >&2
		exit 2
		;;
esac
[ $# -le 1 ] || {
	echo "fetch.sh: too many arguments" >&2
	exit 2
}

cd "$(dirname "$0")"

sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	else
		shasum -a 256 "$1" | cut -d' ' -f1
	fi
}

bad=0
fetched=0
while read -r file sum url; do
	case "$file" in "" | "#"*) continue ;; esac
	if [ -f "$file" ] && [ "$(sha256 "$file")" = "$sum" ]; then
		continue
	fi
	if [ "$check_only" = 1 ]; then
		echo "MISMATCH or missing: $file"
		bad=1
		continue
	fi
	mkdir -p "$(dirname "$file")"
	tmp="$file.part"
	if ! curl -sfL -o "$tmp" "$url"; then
		echo "FAILED to download $url" >&2
		rm -f "$tmp"
		bad=1
		continue
	fi
	got=$(sha256 "$tmp")
	if [ "$got" != "$sum" ]; then
		echo "CHECKSUM MISMATCH for $file: expected $sum, got $got (not kept)" >&2
		rm -f "$tmp"
		bad=1
		continue
	fi
	mv "$tmp" "$file"
	echo "fetched $file"
	fetched=$((fetched + 1))
done <manifest

if [ "$bad" = 0 ]; then
	[ "$check_only" = 1 ] && echo "all files match the manifest" || echo "done ($fetched fetched)"
fi
exit "$bad"
