---
name: research
description: "Multi-agent research: /research <topic> [lead...]. Scopes the topic into a plan (research-plan.md), runs one subagent per plan item, each writing its own report, then merges them into one comprehensive report (an action plan when the topic is a task to get done) and summarizes it. Use when the user runs /research or asks for a fanned-out research report."
argument-hint: "<topic> [lead1] [lead2] ..."
---

# Research

The user asked for a fanned-out research report. Run the three phases below in
order. The user invoking this skill is the request to spawn subagents.

## Arguments

`$ARGUMENTS` (in pi: the text after the command): the first argument is the
**topic**; quote it when it has spaces. Every argument after it is a **lead**:
a URL, file or directory path, repo, product name, person, paper, or a question
to chase. Leads are starting points, not limits. Also accepted:

- `--out DIR`: where to write everything (default below)
- `--max N`: most plan items, so most subagents (default 6, hard cap 10)

If there is no topic, ask for one and stop.

## Output location

Default: `research-<task-slug>/` in the directory the harness was started
in (the session's working directory, usually the repo being worked on), not
wherever you have since cd'd to. `<task-slug>` names the task in a few
kebab-case words, e.g. `migrate-auth-to-oidc` or `pick-vector-db`. If that
directory already exists, add `-2`, `-3`, ... rather than overwrite. Create
it first. It ends up holding:

```
research-plan.md       phase 1
NN-<item-slug>.md      phase 2, one per plan item
report.md              phase 3, the merged report
```

## Phase 1: scope (you, no subagents)

Spend a few minutes on a surface pass, not the research itself:

1. Restate the goal in one or two sentences. Decide its **mode**:
   - **task**: the user wants to get something done (build, choose, fix,
     migrate, buy, set up). The final report is an action plan.
   - **understand**: the user wants to know about something. The final report
     is a structured briefing.
2. Skim each lead (open the URL, list the directory, read the README) and run
   a couple of broad searches, so the plan names real things to look at.
   When the topic touches the local machine or a codebase, look there too.
3. Split the work into 3 to `--max` items that are **independent** (an agent
   can do each without the others' results), **concrete** (a question with an
   answer, not "look into X"), and together **cover** the goal. Fold every lead
   into at least one item. For task mode, include an item on the current state
   or constraints and one on options/approaches, plus risks where they matter.

Write `research-plan.md`:

```markdown
# Research plan: <topic>

- Goal: <one or two sentences>
- Mode: task | understand
- Leads: <list, or "none">
- Output: <dir>

## Items

### 01 <title>
- Question: <the specific question to answer>
- Why: <how it serves the goal>
- Start from: <leads, URLs, paths, search terms>
- Done when: <what a complete answer contains>

### 02 ...
```

Show the user the item titles in a short list, then go straight on to phase 2
without waiting, unless the topic was too ambiguous to plan (then ask).

## Phase 2: one subagent per item

Start every item's agent **in the background, all at once**, then wait for all
of them. Each brief must be self-contained (the agent sees nothing of this
conversation). Use this brief, filled in:

```
You are researching one part of a larger report.

Overall goal: <goal>  (mode: <mode>)
Your item: <NN title>
Question: <question>
Start from: <leads, URLs, paths, search terms>
Done when: <done-when>
Other items cover (stay out of them): <one line per other item>

Research it properly: web search and read the primary sources (official
docs, source code, changelogs, papers, issue trackers) over blog summaries;
inspect local files or code when the item points at them. Read-only: do not
change files, install, or run anything with side effects, except writing
your own report file when told to below. Note dates and versions; prefer
recent sources and say when something may be stale.

Report format (Markdown):
# NN <title>
## Answer            (the direct answer, 3-8 sentences)
## Findings          (bullets; each claim with its source)
## Options / trade-offs   (if any)
## Recommendations   (concrete; for a task, steps and commands)
## Gaps and uncertainty   (what you could not verify or find)
## Sources           (URL or path, with a one-line note each)

<harness-specific delivery line, see below>
```

Per harness:

- **Claude Code**: `Agent` tool, `subagent_type: "general-purpose"`,
  `run_in_background: true`, one call per item, all in one message. Delivery
  line: "Write the report to `<dir>/NN-<item-slug>.md`. Your final message
  is only: the report's path, then a 3-5 line summary of what you found and
  how much good material was available." You are notified as each finishes;
  don't poll, and don't start phase 3 before the last one.
- **pi**: `agent` tool with `readonly: true` and `background: true`, one call
  per item, all in one turn, then `agent_wait` with no ids and a generous
  `timeout_seconds` (e.g. 1800); call it again if some are still running.
  Read-only agents can't write files, so the delivery line is: "Your final
  message is the complete report in the format above, followed by a line
  `SUMMARY:` and a 3-5 line summary of what you found and how much good
  material was available." Save each report body to `<dir>/NN-<item-slug>.md`
  yourself. For web access use the `home-search` MCP tools
  (`searxng_web_search`, `web_url_read`); tell the agents so in the brief.

If an agent fails or comes back thin, note it; re-run it once with a sharper
brief only when the item matters to the goal. After all are in, give the user
one line per item: path and its summary.

## Phase 3: merge (you)

Read every item report in full, then write `report.md`. Merge, don't
concatenate: reconcile contradictions (say which source wins and why),
drop duplicates, and keep the source links.

**Task mode:**

```markdown
# <topic>: report and action plan
<date> · built from N item reports in <dir>

## TL;DR                 (3-5 bullets: the answer and the recommended path)
## Recommended approach  (what to do and why, and what was rejected)
## Action plan           (numbered steps in order; each with what, how
                          (commands, files, settings), how to verify it
                          worked, and rough effort; mark the blocking ones)
## Prerequisites and decisions needed from the user
## Risks and mitigations
## Findings              (by theme, not by item)
## Open questions        (gaps the agents couldn't close; how to close them)
## Sources
## Item reports          (links to NN-*.md with a line each)
```

**Understand mode:** the same, but replace "Recommended approach" and
"Action plan" with "Key findings" (by theme) and "Implications / what to
watch".

Write only what the item reports support. Mark anything you inferred rather
than read as an inference.

## Finish

Reply in chat with: the path to `report.md`, the TL;DR, the first few
action-plan steps (task mode), the biggest open question, and the directory
with the item reports. Keep it short; the detail lives in the report.
