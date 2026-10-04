# Global agent instructions

Shared by every coding agent on this machine. The dotfiles setup symlinks this
file to `~/.claude/CLAUDE.md` (Claude Code) and `~/.pi/agent/AGENTS.md` (pi).
Project-level AGENTS.md / CLAUDE.md files take precedence for project specifics.

## Environment

- Machines run Linux (Ubuntu, sometimes NixOS) or macOS. Don't assume GNU-only
  flags in scripts meant to be portable.
- Personal projects live under `~/dev`.
- Dotfiles live in the `my-tooling` repo. Edit configs there, not
  through the symlinks in `$HOME`.

## Working style

- Be concise. Show diffs and proposed commit messages.
- Match the surrounding code's style, naming, and comment density.
- Prefer small, focused changes. Ask before large refactors or anything
  destructive.
- Run the relevant checks before calling work done.
- Commit only when told (a repo's own AGENTS.md may grant standing
  permission). Never push unless asked.
