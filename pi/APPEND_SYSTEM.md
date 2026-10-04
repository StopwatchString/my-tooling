# pi-specific instructions

Source: `pi/APPEND_SYSTEM.md` in the dotfiles repo (`~/my-tooling`), symlinked to
`~/.pi/agent/APPEND_SYSTEM.md`. Shared instructions for every agent are in
`~/.pi/agent/AGENTS.md` (`agents/AGENTS.md` in the same repo).

## Your harness

Your extensions, skills, prompt templates, and themes live in
`~/my-tooling/pi/`, symlinked into `~/.pi/agent/`. If you notice friction in how
you work (a missing tool, a repeated manual step, a prompt worth reusing),
suggest a concrete improvement there. Read `~/my-tooling/pi/AGENTS.md` before
changing it.

## Tools

- `rg` and `fd` are available; prefer them over `grep -r` and `find`.
