#!/bin/sh
# wt.sh: git worktrees and the merge lock for the implement skill.
#
# Every unit of work gets <repo>/worktrees/agent-<name> on branch agent-<name>,
# branched from the branch checked out in the main checkout (its "base", kept in
# git config as branch.agent-<name>.agentBase). Landing on the base happens under
# one lock per repository, <git common dir>/agent-merge.lock (a directory, so
# taking it is atomic), shared by every pi and Claude Code session.
# POSIX sh; runs from anywhere inside the repository or one of its worktrees.

set -eu

LOCK_STALE=${WT_LOCK_STALE:-600}   # seconds before a lock counts as abandoned

usage() {
	cat <<'EOF'
usage: wt.sh <command> [args]

  create <name>            new worktree + branch agent-<name> from the main
                           checkout's branch; takes the first free <name>,
                           <name>-2, ... and prints name=, path=, branch=, base=
  info <name>              path, branch, base, fork point, whether the base moved
  lock <name> [timeout]    take the merge lock (waits; default 900s). exit 3 on timeout
  check <name>             under the lock: commit leftovers in the worktree, then
                           exit 0 if the base hasn't moved past it (lock kept), or
                           exit 10 and release the lock if it has
  land <name> <msgfile>    under the lock: squash the work into one commit on the
                           base, update the base, remove the worktree and branch,
                           release the lock. exit 10 if the base moved, 5 if the
                           main checkout's local edits are in the way
  unlock <name>            release the lock if <name> holds it
  remove <name>            discard the worktree and branch (abandon the work)
  list                     agent worktrees and the lock holder
EOF
}

die() {
	printf 'wt: %s\n' "$*" >&2
	exit "${2:-1}"
}

fail() { # message, exit code
	printf 'wt: %s\n' "$1" >&2
	exit "$2"
}

setup() {
	common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || die "not inside a git repository"
	root=$(dirname "$common")
	[ -d "$root/.git" ] || die "can't find the main checkout (bare repository?)"
	lockdir="$common/agent-merge.lock"
}

valid_name() {
	case $1 in
		'' | -* | *[!a-z0-9-]*) die "name must be lowercase letters, digits and dashes: '$1'" ;;
	esac
}

load() { # name -> path, branch, base
	valid_name "$1"
	name=$1
	branch="agent-$name"
	wtpath="$root/worktrees/$branch"
	[ -d "$wtpath" ] || die "no worktree $wtpath"
	base=$(git -C "$root" config "branch.$branch.agentBase") || die "branch $branch has no recorded base"
}

lock_owner() {
	cat "$lockdir/owner" 2>/dev/null || true
}

# Check that <name> holds the lock. From here on the lock is released on any exit
# unless keep_lock=1 (check passing), so a failure part way never leaves it held.
require_lock() {
	owner=$(lock_owner)
	[ "${owner%% *}" = "$name" ] || die "the merge lock is not held by $name (holder: ${owner:-nobody})"
	holding=1
}

release() {
	owner=$(lock_owner)
	if [ "${owner%% *}" = "$name" ]; then rm -rf "$lockdir"; fi
}

# Commit anything left uncommitted in the worktree (squashed away on landing).
commit_leftovers() {
	git -C "$wtpath" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && die "a merge is in progress in $wtpath; finish or abort it"
	git -C "$wtpath" add -A
	if [ -n "$(git -C "$wtpath" status --porcelain)" ]; then
		git -C "$wtpath" commit -q --no-verify -m "wip: $name"
	fi
}

cmd_create() {
	[ $# -eq 1 ] || die "usage: create <name>"
	valid_name "$1"
	base=$(git -C "$root" symbolic-ref -q --short HEAD) || die "the main checkout is on a detached HEAD; check out a branch first"
	git -C "$root" rev-parse -q --verify HEAD >/dev/null || die "the repository has no commits yet"
	exclude=$(git -C "$root" rev-parse --path-format=absolute --git-path info/exclude)
	mkdir -p "$(dirname "$exclude")"
	grep -qx '/worktrees/' "$exclude" 2>/dev/null || printf '/worktrees/\n' >>"$exclude"
	n=1
	while :; do
		name=$1
		[ $n -gt 1 ] && name="$1-$n"
		branch="agent-$name"
		wtpath="$root/worktrees/$branch"
		if [ ! -e "$wtpath" ] && ! git -C "$root" rev-parse -q --verify "refs/heads/$branch" >/dev/null &&
			git -C "$root" worktree add -q -b "$branch" "$wtpath" "$base" 2>/dev/null; then
			break
		fi
		n=$((n + 1))
		[ $n -le 50 ] || die "no free worktree name for $1"
	done
	git -C "$root" config "branch.$branch.agentBase" "$base"
	printf 'name=%s\npath=%s\nbranch=%s\nbase=%s\nstart=%s\n' "$name" "$wtpath" "$branch" "$base" "$(git -C "$wtpath" rev-parse --short HEAD)"
	if [ -n "$(git -C "$root" status --porcelain --untracked-files=no)" ]; then
		echo "note: the main checkout has uncommitted changes; the worktree doesn't have them"
	fi
}

cmd_info() {
	[ $# -eq 1 ] || die "usage: info <name>"
	load "$1"
	tip=$(git -C "$root" rev-parse "refs/heads/$base")
	fork=$(git -C "$wtpath" merge-base HEAD "$tip")
	moved=no
	[ "$fork" = "$tip" ] || moved=yes
	printf 'path=%s\nbranch=%s\nbase=%s\nbase_tip=%s\nfork_point=%s\nbase_moved=%s\n' \
		"$wtpath" "$branch" "$base" "$(git -C "$root" rev-parse --short "$tip")" "$(git -C "$root" rev-parse --short "$fork")" "$moved"
	printf 'diff: git -C %s diff %s   (all of this work, committed or not)\n' "$wtpath" "$(git -C "$root" rev-parse --short "$fork")"
	printf 'lock=%s\n' "$(lock_owner)"
}

cmd_lock() {
	[ $# -ge 1 ] && [ $# -le 2 ] || die "usage: lock <name> [timeout]"
	load "$1"
	deadline=$(($(date +%s) + ${2:-900}))
	while ! mkdir "$lockdir" 2>/dev/null; do
		owner=$(lock_owner)
		since=$(printf '%s' "$owner" | awk '{print $3}')
		now=$(date +%s)
		if [ "${owner%% *}" = "$name" ]; then
			echo "locked (already held by $name)"
			return
		fi
		if [ -n "$since" ] && [ $((now - since)) -gt "$LOCK_STALE" ]; then
			echo "note: taking over a stale lock ($owner)"
			rm -rf "$lockdir"
			continue
		fi
		[ "$now" -lt "$deadline" ] || fail "timed out waiting for the merge lock (holder: ${owner:-?})" 3
		sleep 2
	done
	printf '%s %s %s\n' "$name" "$(hostname)" "$(date +%s)" >"$lockdir/owner"
	echo "locked"
}

cmd_unlock() {
	[ $# -eq 1 ] || die "usage: unlock <name>"
	valid_name "$1"
	name=$1
	release
	echo "unlocked"
}

cmd_check() {
	[ $# -eq 1 ] || die "usage: check <name>"
	load "$1"
	require_lock
	commit_leftovers
	tip=$(git -C "$root" rev-parse "refs/heads/$base")
	if git -C "$wtpath" merge-base --is-ancestor "$tip" HEAD; then
		keep_lock=1
		echo "clean: $base ($(git -C "$root" rev-parse --short "$tip")) is in the worktree; lock kept, land next"
		return
	fi
	fork=$(git -C "$wtpath" merge-base HEAD "$tip")
	echo "moved: $base is at $(git -C "$root" rev-parse --short "$tip"), the worktree forked at $(git -C "$root" rev-parse --short "$fork"); lock released"
	echo "new upstream commits:"
	git -C "$root" log --oneline "$fork..$tip"
	echo "merge them in: git -C $wtpath merge $(git -C "$root" rev-parse --short "$tip")"
	exit 10
}

cmd_land() {
	[ $# -eq 2 ] || die "usage: land <name> <msgfile>"
	load "$1"
	case $2 in
		/*) msg=$2 ;;
		*) msg="$(pwd)/$2" ;;
	esac
	[ -s "$msg" ] || die "commit message file $msg is missing or empty"
	require_lock
	commit_leftovers
	tip=$(git -C "$root" rev-parse "refs/heads/$base")
	if ! git -C "$wtpath" merge-base --is-ancestor "$tip" HEAD; then
		fail "$base moved since the check; lock released, run check again" 10
	fi
	if [ "$(git -C "$wtpath" rev-parse 'HEAD^{tree}')" = "$(git -C "$root" rev-parse "$tip^{tree}")" ]; then
		new=""
	else
		new=$(git -C "$wtpath" commit-tree 'HEAD^{tree}' -p "$tip" -F "$msg")
		# Where is the base checked out? Update that checkout's files too, else just the ref.
		checkout=$(git -C "$root" worktree list --porcelain | awk -v b="branch refs/heads/$base" '
			/^worktree / { wt = substr($0, 10) }
			$0 == b { print wt; exit }')
		if [ -n "$checkout" ]; then
			if [ "$(git -C "$checkout" rev-parse HEAD)" != "$tip" ]; then
				fail "$base moved in $checkout since the check; lock released, run check again" 10
			fi
			if ! git -C "$checkout" merge -q --ff-only "$new"; then
				fail "couldn't fast-forward $base in $checkout (local edits in the way?). The squashed commit is $new: 'git -C $checkout merge --ff-only $new' once they're out of the way. Worktree kept; lock released." 5
			fi
		else
			git -C "$root" update-ref "refs/heads/$base" "$new" "$tip"
		fi
	fi
	git -C "$root" worktree remove --force "$wtpath"
	git -C "$root" branch -q -D "$branch"
	if [ -n "$new" ]; then
		echo "landed: $base is now $(git -C "$root" rev-parse --short "$new"); worktree and branch removed, lock released"
	else
		echo "nothing to land: no changes; worktree and branch removed, lock released"
	fi
}

cmd_remove() {
	[ $# -eq 1 ] || die "usage: remove <name>"
	load "$1"
	release
	git -C "$root" worktree remove --force "$wtpath"
	git -C "$root" branch -q -D "$branch"
	echo "removed $wtpath and branch $branch"
}

cmd_list() {
	git -C "$root" worktree list | grep "/worktrees/agent-" || echo "no agent worktrees"
	echo "lock: $(lock_owner)"
}

[ $# -ge 1 ] || {
	usage >&2
	exit 2
}
cmd=$1
shift
holding=0
keep_lock=0
# Top level, not in a function: zsh runs a function's EXIT trap when the function returns.
trap '[ "$holding" = 0 ] || [ "$keep_lock" = 1 ] || release' EXIT
case $cmd in
	-h | --help | help) usage ;;
	create | info | lock | unlock | check | land | remove | list)
		setup
		"cmd_$cmd" "$@"
		;;
	*)
		usage >&2
		exit 2
		;;
esac
