---
description: Improve the pi harness (~/my-tooling/pi)
argument-hint: "[change to make]"
---
Work in the pi config at ~/my-tooling/pi (part of the dotfiles repo). That directory is the code that runs you, so be careful.

1. Read ~/my-tooling/pi/AGENTS.md first.
2. Task: ${@:-ask me what friction I want fixed. If something in this session already suggests an improvement, propose it, but don't start until I agree}.
3. Read the relevant pi docs and examples listed in AGENTS.md before writing code. Do not guess at the API.
4. Make the smallest change that does the job. Then run the checks from AGENTS.md and fix every error.
5. Update README.md if a resource was added or removed. Commit as AGENTS.md describes, show me the diff and the commit message, and tell me to run /reload to try it.
