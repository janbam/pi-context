# Context Management Reference-Read Eval Notes

This eval set checks whether the skill not only triggers, but also routes into the **right reference files** for the task shape.

## What this set tests

1. **Primary reference routing**
   - Does a search-heavy task read `search-research-and-reading.md`?
   - Does a plan-driven task read `planning-and-execution.md`?
   - Does repeated-item work read `repeated-items-and-batch-work.md`?

2. **Cross-cutting retry routing**
   - When retry / branch / pivot behavior becomes central, does the agent additionally read `retry-branch-and-pivot.md`?

3. **Web search and webpage reading routing**
   - When the task explicitly involves web search, browser operation, or reading low-density webpages, does the agent still route into `search-research-and-reading.md`?

4. **Ref usage discipline**
   - The skill should not need to read every ref for every task.
   - The right behavior is usually one primary ref, plus the retry ref only when branch behavior matters.

## Current expected routing

| Case | Expected ref(s) |
|---|---|
| 1 | `search-research-and-reading.md` |
| 2 | `development-and-troubleshooting.md` |
| 3 | `planning-and-execution.md` |
| 4 | `repeated-items-and-batch-work.md` |
| 5 | `task-switching-and-cleanup.md` |
| 6 | `development-and-troubleshooting.md` + `retry-branch-and-pivot.md` |
| 7 | `search-research-and-reading.md` |

## Important interpretation note

This set is about **reference-read behavior**, not just tool usage.
A run can trigger context tools correctly but still fail this eval if it never reads the scenario reference that the skill's routing implies.
