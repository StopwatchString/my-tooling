---
name: implement
description: "Multi-agent implementation: /implement <plan>. Turns a plan (a research report, a plan file, or a plain description) into ordered steps, marks what can run in parallel, and runs each step through its own git worktree with fresh agents: implementer, optional unit tester, reviewer (looping back for fixes until it passes), then a locked merge-back that lands one squashed commit on the base branch. Use when the user runs /implement or asks for a change to be built by subagents in worktrees."
argument-hint: "<plan file | research dir | description> [--yes]"
---

# Implement

The user asked for a change to be built by subagents. You are the
coordinator: you plan, brief agents, run `wt.sh`, and track state. You don't
edit the code yourself, and nothing touches the main checkout until a step
lands. Several `/implement` runs (in pi or Claude Code, in one session or many)
may work on the same repository at once; the worktrees and the merge lock keep
them apart.

`WT` below means the `wt.sh` next to this SKILL.md (in
`~/.claude/skills/implement/` or `~/.agents/skills/implement/`); call it by
its absolute path. `ROLES` is the `roles/` directory next to it. Run
`$WT --help` once if you need the command list.

## Arguments

`$ARGUMENTS` (in pi: the text after the command) is the plan:

- a file (`research-*/report.md`, a plan or issue written down), or a
  `research-<task>/` directory, which means its `report.md`;
- otherwise, the text itself is the description.
- `--yes`: skip the approval wait in phase 2.
- An existing `implement-<task>/` directory resumes that run (see Resuming).

If there is no plan at all, ask for one and stop.

## Phase 1: understand

1. Read the plan input in full.
2. Check the repository: you must be in a git repository with a branch
   checked out (not a detached HEAD). That branch is the **base**: every step
   forks from it and lands on it. If the main checkout has uncommitted
   changes, say so: worktrees won't have them, and edits to the same files
   can block landing. Ask whether to commit them first if the plan needs them.
3. Learn how the repo works: its AGENTS.md / CLAUDE.md / README, the build,
   check and test commands, the test framework and layout, and the commit
   message style (`git log --oneline -15`). Briefs carry this, so agents
   don't each rediscover it.
4. Read the code the plan touches, enough to cut it into steps.

## Phase 2: implementation plan

Create `implement-<task-slug>/` in the directory the harness was started in
(add `-2`, ... if it exists). `<task-slug>`: a few kebab-case words naming the
task. Write `implement-<task-slug>/plan.md`:

```markdown
# Implementation plan: <task>

- Goal: <one or two sentences>
- Source: <plan file / "user description">
- Repo: <main checkout path> · Base: <branch> at <short sha>
- Checks: <build / test / lint commands>

## Steps

### S1 <title>                       slug: <step-slug>
- Depends on: none | S<n>, ...
- Tests: yes | no (<why>)
- Touches: <files or areas>
- Spec: <what to change and how, precisely enough for a fresh agent>
- Done when: <acceptance criteria and the checks that prove them>

### S2 ...

## Waves
1. S1, S2   (parallel: touch different files)
2. S3       (needs S1)

## Status
| step | worktree | stage | rounds | result |
|---|---|---|---|---|
| S1 | | pending | | |
```

Cutting steps:
- A step is one coherent change that lands as one commit and that one agent
  can implement and one reviewer can judge. Prefer a few solid steps over
  many tiny ones.
- Steps in the same wave run in parallel, so they must not edit the same
  files; if two would, make one depend on the other. A step that builds on
  another's code depends on it: it starts only after that one has **landed**,
  so its worktree contains it.
- `Tests: yes` when the step adds behavior worth pinning and the repository
  has a test suite; `no` for config, docs, glue, or repos without tests.

Show the user the steps, waves, and which get tests, then **wait for
approval** (unless `--yes`). Apply any edits they ask for to `plan.md`.

## Phase 3: run the workflows

Start every step whose dependencies have landed. Each runs the workflow
below independently: when any agent finishes, advance *that* step right
away (save its report, start its next stage) without waiting for the
others. When a step lands, start the steps it unblocked. Keep the Status
table in `plan.md` current at every transition; it is how a run resumes.

### Per-step workflow

Reports live in `implement-<task>/steps/<step-slug>/`, numbered in order:
`01-implement.md`, `02-test.md`, `03-review.md`, `04-implement-fix.md`, ...
Save each agent's final message there yourself as soon as it arrives.

**0. Worktree.** `$WT create <step-slug>`. Note the `name=` (it may get a
suffix) and `path=` it prints; use that name for every later `$WT` call.

**1. Implementer** (fresh agent, role `implementer.md`): the step's spec.

**2. Tester** (only `Tests: yes`; fresh agent, role `tester.md`): the spec
and the implementer's report.

**3. Reviewer** (fresh agent, read-only, role `reviewer.md`): the spec and
every report so far, including the previous review on a re-review. Parse
its last `VERDICT:` and `RETEST:` lines.
- `PASS` → step 4.
- `FAIL` → correction pass: a fresh implementer with the review (findings
  marked `[impl]`); then, if `RETEST: yes` or there are `[tests]` findings
  and the step has tests, a fresh tester with the review and the fix report;
  then a fresh reviewer again. Loop until `PASS`. After 5 failed reviews of
  one step, pause that step and ask the user how to proceed.
- No verdict line, or the agent failed: run that stage again once with a
  fresh agent; if it fails again, pause the step and ask.

**4. Merge-back** (you, with `$WT`). First write the commit message (below)
to `steps/<step-slug>/commit.txt`, so nothing slow happens under the lock.
Then `$WT lock <name>` (waits for other workflows; exit 3 = timed out, run
it again) and `$WT check <name>`:
- exit 0 (`clean`): the base hasn't moved past the worktree. You hold the
  lock; go **straight** to step 6 in the same turn.
- exit 10 (`moved`): another workflow landed first. `check` already released
  the lock; go to step 5 with its output.

**5. Merger** (fresh agent, role `merger.md`): the `check` output (base
commit, fork point, new upstream commits), the spec, and the latest
implementer report. Parse its `REWORK:` line.
- `no` → back to step 4.
- `yes` → back to step 1 (a fresh implementer with the merger's report),
  then 2 if the step has tests, then 3, then 4.

**6. Land** (you, with `$WT`, still holding the lock): `$WT land <name>
implement-<task>/steps/<step-slug>/commit.txt`. It squashes the work into one
commit on the base, updates the main checkout, removes the worktree and
branch, and releases the lock.
- exit 0: record the commit in the Status table. The step is done.
- exit 10: the base moved after all (someone committed by hand); back to 4.
- exit 5: local edits in the main checkout block the fast-forward. The
  worktree is kept and the lock released. Pause the step and tell the user
  the command `land` printed.

If anything goes wrong between a successful `lock` and the end of `land`,
run `$WT unlock <name>` before doing anything else. Never leave the lock held
while an agent runs.

**Commit message:** the repository's style if it has one; otherwise an
imperative subject under 72 characters and a short body: what changed and
why, from the reports. Never mention the model, the agent or the workflow:
no `Co-Authored-By`, "Generated with" or agent names.

### Briefing agents

Every agent starts fresh. Build its prompt from this header, the role file
(read `ROLES/<role>.md` and paste it in), and the stage's inputs:

```
You are the <role> for one step of a multi-agent implementation.
You have no context beyond this brief and the files it names.

Workspace: <path>, a git worktree on branch agent-<name>, forked from
<base>. Work only inside it: cd into it for every shell command and use
absolute paths under it for file edits. Never modify the main checkout
(<main checkout path>) or any other worktree; other agents are working in
parallel there. Untracked and ignored files (node_modules, build output,
.env) and submodules start out missing; set up what your checks need here.
All of this step's work so far:
  git -C <path> diff $(git -C <path> merge-base HEAD <base>)

Repository notes: <build/check/test commands, test layout, conventions>
Overall goal: <goal>
This step: <step title, spec and done-when from plan.md>
Read first: <absolute paths of the earlier reports this stage needs>

<role file>
```

Hand off only what the stage needs: the implementer gets the spec (plus the
review or merger report on a correction pass), the tester the spec and the
implementer's report, the reviewer everything for this step.

Per harness:
- **Claude Code**: `Agent` tool, `subagent_type: "general-purpose"`,
  `run_in_background: true`. You are notified as each finishes; don't poll.
  Start all of a wave's first stages in one message.
- **pi**: `agent` tool with `cwd: <worktree path>` and `background: true`;
  the reviewer also gets `readonly: true`. Results arrive as `agent-result`
  messages; handle each as it comes. Don't block on `agent_wait` for all of
  them: that stalls the steps that are ready to advance. Up to
  `subagents.maxConcurrency` run at once; the rest queue.

## Phase 4: wrap up

Once every step has landed or is paused:

1. Run the repository's checks in the main checkout on the combined result.
   If they fail, say so; if the cause is clear, offer a follow-up fix step.
2. Write `implement-<task>/report.md`: each step with its commit (short sha
   and subject), review rounds, merges, and notable decisions; paused steps
   with their worktree and what's blocking them; the final checks; follow-ups.
3. Reply in chat: the commits that landed, the check results, anything
   paused or needing the user, and the path to `report.md`. Short.

Never push.

## Resuming

Given an `implement-<task>/` directory, read its `plan.md` Status table and
the reports, and run `$WT list` and `$WT info <name>` for each unfinished
step. Pick each step up at the stage after its last saved report. If the
lock is held by a step of this run that isn't between `check` and `land`,
`$WT unlock` it.
