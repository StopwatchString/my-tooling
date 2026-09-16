#!/usr/bin/env bash
# nvidia-nix-link.sh — Expose the host NVIDIA driver at /run/opengl-driver/lib
# for Nix-built CUDA binaries on non-NixOS hosts.
set -euo pipefail

LINK=/run/opengl-driver                         # Nix convention; /run is tmpfs
STORE=/var/lib/nvidia-driver-link               # persistent link directory
TMPFILES=/etc/tmpfiles.d/nvidia-driver-link.conf

usage() {
  cat <<EOF
Usage:
  sudo $(basename "$0")                          Set up or refresh the links, then verify.
  $(basename "$0") --check [BINARY]              Verify only (BINARY defaults to ninfer-serve on PATH).
  sudo $(basename "$0") --uninstall [--dry-run]  Remove everything setup created.

Re-run setup after every NVIDIA driver upgrade.
EOF
}

die()  { echo "error: $*" >&2; exit 1; }
fail=0
ok()   { printf '  ok    %s\n' "$*"; }
warn() { printf '  warn  %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; fail=$((fail + 1)); }

# ---- Discovery ----
host_ldconfig() {
  local c
  for c in /sbin/ldconfig /usr/sbin/ldconfig; do
    [[ -x $c ]] && { echo "$c"; return 0; }
  done
  return 1
}

# Directory holding the host's 64-bit libcuda.so.1 (never a stub).
discover_libdir() {
  local lc path=""
  if lc=$(host_ldconfig); then
    path=$("$lc" -p | awk '$1 == "libcuda.so.1" && /x86-64/ {print $NF; exit}')
  fi
  if [[ -z $path ]]; then
    local d
    for d in /usr/lib/x86_64-linux-gnu /usr/lib64 /usr/lib; do
      [[ -e $d/libcuda.so.1 ]] && { path=$d/libcuda.so.1; break; }
    done
  fi
  [[ -n $path ]] || die "host libcuda.so.1 not found; is the NVIDIA driver installed?"
  [[ $path != */stubs/* ]] || die "host libcuda.so.1 resolves to a stub: $path"
  dirname "$path"
}

kernel_version() {
  cat /sys/module/nvidia/version 2>/dev/null && return 0
  awk '/NVRM version/ { for (i = 1; i <= NF; i++)
         if ($i ~ /^[0-9]+\.[0-9]+(\.[0-9]+)?$/) { print $i; exit } }' \
      /proc/driver/nvidia/version 2>/dev/null
}

# Version suffix of the real file behind DIR/libcuda.so.1, e.g. 580.95.05.
user_version() {
  local real v
  real=$(readlink -f "$1/libcuda.so.1" 2>/dev/null) || return 1
  v=${real##*/libcuda.so.}
  [[ $v =~ ^[0-9]+\.[0-9]+ ]] || return 1
  echo "$v"
}

# ---- Setup ----
tmp=""
setup() {
  [[ $EUID -eq 0 ]] || die "setup requires root (run with sudo), or use --check"
  command -v systemd-tmpfiles >/dev/null || die "systemd-tmpfiles not found"

  local libdir kv uv f n=0
  libdir=$(discover_libdir)
  echo "Host driver libraries: $libdir"

  kv=$(kernel_version || true)
  uv=$(user_version "$libdir" || true)
  if [[ -n $kv && -n $uv && $kv != "$uv" ]]; then
    warn "kernel module $kv != user-space driver $uv (reboot after driver upgrade?)"
  fi

  # Build the new link set in a staging dir, then swap it in.
  mkdir -p "$STORE"
  tmp=$(mktemp -d "$STORE/.lib.XXXXXX")
  trap 'rm -rf "${tmp:-}"' EXIT
  chmod 755 "$tmp"

  shopt -s nullglob
  for f in "$libdir"/{libcuda,libcudadebugger,libnvcuvid,libnvoptix}.so* \
           "$libdir"/libnvidia-*.so*; do
    ln -s "$f" "$tmp/${f##*/}"
    n=$((n + 1))
  done
  shopt -u nullglob
  [[ -e $tmp/libcuda.so.1 ]] || die "libcuda.so.1 missing from staged links"

  rm -rf "$STORE/.lib.old"
  [[ -e $STORE/lib ]] && mv "$STORE/lib" "$STORE/.lib.old"
  mv "$tmp" "$STORE/lib"
  rm -rf "$STORE/.lib.old"
  echo "Linked $n driver libraries into $STORE/lib"

  # L+ replaces whatever currently exists at $LINK, at boot and now.
  printf 'L+ %s - - - - %s\n' "$LINK" "$STORE" > "$TMPFILES"
  systemd-tmpfiles --create "$TMPFILES"
  echo "Installed $TMPFILES"
}

# ---- Verification ----
check() {
  local bin="${1:-$(command -v ninfer-serve || true)}"
  local real dangling kv uv
  echo "Checking $LINK"

  if [[ -L $LINK ]]; then ok "$LINK -> $(readlink "$LINK")"
  elif [[ -e $LINK ]]; then warn "$LINK exists but is not a symlink (not managed by this script)"
  else bad "$LINK does not exist (run setup)"
  fi

  real=$(readlink -f "$LINK/lib/libcuda.so.1" 2>/dev/null || true)
  if [[ -z $real || ! -e $real ]]; then
    bad "$LINK/lib/libcuda.so.1 missing or dangling"
  elif [[ $real == */stubs/* ]]; then
    bad "$LINK/lib/libcuda.so.1 points to a stub: $real"
  else
    ok "libcuda.so.1 -> $real"
  fi

  dangling=$(find "$LINK/lib/" -maxdepth 1 -xtype l 2>/dev/null | wc -l)
  if (( dangling > 0 )); then
    bad "$dangling dangling links (driver upgraded? re-run setup)"
  fi

  kv=$(kernel_version || true)
  uv=$(user_version "$LINK/lib" || true)
  if [[ -z $kv || -z $uv ]]; then warn "could not compare driver versions (kernel='$kv' user='$uv')"
  elif [[ $kv == "$uv" ]]; then ok "driver version $kv (kernel and user-space match)"
  else bad "kernel module $kv != linked user-space $uv"
  fi

  [[ -f $TMPFILES ]] && ok "boot persistence: $TMPFILES" || bad "missing $TMPFILES (link will vanish on reboot)"

  if [[ -z $bin ]]; then
    warn "no binary given and ninfer-serve not on PATH; skipping binary checks"
    return
  fi
  command -v readelf >/dev/null || { warn "readelf not found; skipping binary checks"; return; }

  bin=$(readlink -f "$bin")
  echo "Checking $bin"

  local rp di="" si="" i res
  local -a parts=()
  rp=$(readelf -d "$bin" 2>/dev/null | awk -F'[][]' '/\((RUNPATH|RPATH)\)/ {print $2; exit}')
  IFS=: read -ra parts <<< "$rp"
  for i in "${!parts[@]}"; do
    case "${parts[i]}" in
      "$LINK/lib") : "${di:=$i}" ;;
      */stubs)     : "${si:=$i}" ;;
    esac
  done
  if [[ -z $di ]]; then
    bad "RUNPATH lacks $LINK/lib (rebuild with cudaPackages.autoAddDriverRunpath)"
  elif [[ -n $si ]] && (( si < di )); then
    bad "stubs dir precedes $LINK/lib in RUNPATH (strip it in postFixup)"
  else
    ok "RUNPATH order is correct"
  fi

  res=$(env -u LD_LIBRARY_PATH -u LD_PRELOAD LD_TRACE_LOADED_OBJECTS=1 "$bin" 2>/dev/null \
        | awk '$1 == "libcuda.so.1" {print $3; exit}' || true)
  if [[ $res == "$LINK/lib/libcuda.so.1" ]]; then
    ok "libcuda.so.1 resolves to $res"
  else
    bad "libcuda.so.1 resolves to ${res:-nothing}"
    res=$(env LD_LIBRARY_PATH="$LINK/lib" LD_TRACE_LOADED_OBJECTS=1 "$bin" 2>/dev/null \
          | awk '$1 == "libcuda.so.1" {print $3; exit}' || true)
    if [[ $res == "$LINK/lib/libcuda.so.1" ]]; then
      echo "        stopgap works: LD_LIBRARY_PATH=$LINK/lib $(basename "$bin") ..."
    fi
  fi
}

# ---- Uninstall ----
DRY=""
# act DESCRIPTION CMD...: run CMD (or just report it in dry-run mode).
act() {
  local desc=$1; shift
  if [[ -n $DRY ]]; then printf '  would %s\n' "$desc"
  else "$@" && ok "$desc"
  fi
}

uninstall() {
  [[ $EUID -eq 0 || -n $DRY ]] || die "uninstall requires root (run with sudo), or add --dry-run"
  local expected kept=0
  echo "Uninstalling${DRY:+ (dry run)}"

  # 1. Runtime link: remove only if it points at our store.
  if [[ -L $LINK ]]; then
    if [[ $(readlink "$LINK") == "$STORE" ]]; then
      act "remove $LINK" rm -f "$LINK"
    else
      warn "$LINK -> $(readlink "$LINK") is not ours; left in place"; kept=1
    fi
  elif [[ -e $LINK ]]; then
    warn "$LINK is not a symlink; left in place"; kept=1
  fi

  # 2. Boot persistence: remove only if unmodified.
  expected="L+ $LINK - - - - $STORE"
  if [[ -L $TMPFILES ]]; then
    warn "$TMPFILES is a symlink; left in place"; kept=1
  elif [[ -f $TMPFILES ]]; then
    if [[ $(<"$TMPFILES") == "$expected" ]]; then
      act "remove $TMPFILES" rm -f "$TMPFILES"
    else
      warn "$TMPFILES has been modified; left in place"; kept=1
    fi
  fi

  # 3. Link store: delete symlinks (never their targets), then empty dirs.
  if [[ -L $STORE ]]; then
    warn "$STORE is a symlink; left in place"; kept=1
  elif [[ -d $STORE ]]; then
    if [[ -n $(find "$STORE" -mindepth 1 ! -type l ! -type d -print -quit) ]]; then
      warn "$STORE contains regular files; left in place"; kept=1
    else
      act "remove driver symlinks under $STORE" find "$STORE" -mindepth 1 -type l -delete
      act "remove $STORE" find "$STORE" -depth -type d -empty -delete
      if [[ -z $DRY && -e $STORE ]]; then
        warn "$STORE not fully removed"; kept=1
      fi
    fi
  fi

  echo
  if (( kept )); then echo "Done; some items were left in place (see warnings)."
  else echo "Done; no changes from setup remain."
  fi
}

# ---- Main ----
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --check)   check "${2:-}" ;;
  --uninstall)
    case "${2:-}" in
      "")        ;;
      --dry-run) DRY=1 ;;
      *)         usage >&2; exit 2 ;;
    esac
    uninstall; exit 0 ;;
  "")        setup; echo; check "" ;;
  *)         usage >&2; exit 2 ;;
esac
(( fail == 0 )) && echo "All checks passed." || { echo "$fail check(s) failed."; exit 1; }
