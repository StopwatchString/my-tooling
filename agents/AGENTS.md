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

- Match the surrounding code's style, naming, and comment density.
- Prefer small, focused changes. Ask before large refactors or anything
  destructive.
