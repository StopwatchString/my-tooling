# Global agent instructions

Shared by every coding agent on this machine. The dotfiles setup copies this
file (with any downstream layers' agents/AGENTS.md after it) into a managed
block in `~/.claude/CLAUDE.md` (Claude Code) and `~/.pi/agent/AGENTS.md` (pi).
Project-level AGENTS.md / CLAUDE.md files take precedence for project specifics.

## Environment

- Machines run Linux (Ubuntu, sometimes NixOS) or macOS. Don't assume GNU-only
  flags in scripts meant to be portable.
- Personal projects live under `~/dev`.
- Dotfiles live in the `my-tooling` repo (plus any downstream layer repos;
  see its `docs/integration-guide.md`). Edit configs there, then re-run
  `./setup.sh`; don't edit the managed blocks or generated files in `$HOME`.

## Working style

- Be concise. Show diffs and proposed commit messages.
- Match the surrounding code's style, naming, and comment density.
- Prefer small, focused changes. Ask before large refactors or anything
  destructive.
- Run the relevant checks before calling work done.
- In a git repo, implement in a worktree by default, not in the main
  checkout, so several agents can work on one repo at once:
  `git worktree add <repo>/worktrees/<name> -b <branch>`. Keep
  `worktrees/` out of git status with a line in
  `$(git rev-parse --git-common-dir)/info/exclude`, not `.gitignore`. Skip
  this only when told to, or when the repo's own AGENTS.md says otherwise.
- When the work in a worktree is done and its checks pass, commit it and
  merge it back into the main checkout's branch yourself. Only one agent
  merges at a time, under a lock:
  1. Take the lock: `mkdir "$(git rev-parse --git-common-dir)/merge.lock"`
     (atomic; it fails while another agent holds it). Retry until it
     succeeds. If it stays taken for more than ~15 minutes, ask the user
     rather than removing it.
  2. Rebase onto the up-to-date branch: `git rebase <main branch>` in the
     worktree. Resolve simple conflicts; for anything unclear,
     `git rebase --abort`, release the lock and ask. If the rebase brought
     in new commits, run the checks again.
  3. Fast-forward the main checkout:
     `git -C <main checkout> merge --ff-only <branch>`. If it refuses
     (e.g. uncommitted changes there touch the same files), release the
     lock and ask; never force it.
  4. Release the lock: `rmdir "$(git rev-parse --git-common-dir)/merge.lock"`,
     also on every failure path.
  5. Remove the worktree and branch: `git worktree remove <path>`,
     `git branch -d <branch>`.
- Outside that flow, commit only when told (a repo's own AGENTS.md may
  grant standing permission). Never push unless asked.
- Never mention the model or agent in commit messages: no `Co-Authored-By`
  trailer, "Generated with" line or model name.

## Skills

- Shared skills live in `my-tooling/ai/skills/` (and downstream layers'
  `ai/skills/`) and are linked one by one for both Claude Code and pi.
- Before writing, editing, reviewing, or planning any C++ code (`.h`, `.hpp`,
  `.cpp`, `.cc`, `.cxx`), load the `cpp-style-guide` skill.
