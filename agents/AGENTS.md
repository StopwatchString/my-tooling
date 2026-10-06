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
- Commit only when told (a repo's own AGENTS.md may grant standing
  permission). Never push unless asked.
- Never mention the model or agent in commit messages: no `Co-Authored-By`
  trailer, "Generated with" line or model name.

## Skills

- Shared skills live in `my-tooling/ai/skills/` (and downstream layers'
  `ai/skills/`) and are linked one by one for both Claude Code and pi.
- Before writing, editing, reviewing, or planning any C++ code (`.h`, `.hpp`,
  `.cpp`, `.cc`, `.cxx`), load the `cpp-style-guide` skill.
