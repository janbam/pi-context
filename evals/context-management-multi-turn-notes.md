# Multi-turn eval set notes

This eval set exists specifically to test behavior that the single-turn runner cannot see.

## What it measures

### 1. Completed task -> follow-up
After a noisy but finished task, if the user simply asks for:
- a refinement
- a rewrite
- a clarification
- a correction

then the agent should usually **not** compact first. The just-finished segment is still the active working context.

### 2. Completed task -> new unrelated task
After a noisy but finished task, if the user starts a clearly different task, the agent should usually:
- summarize the completed noisy segment
- compact to the best clean anchor
- start the new task from the compacted state

This is the main regression target for the current skill revision.

### 3. Same task -> next phase
If the previous phase is complete and the user is clearly continuing the same task into a new phase, a compact can be correct.

This guards against over-correcting the skill into "never compact after finishing anything".

## Why a separate runner exists

`run_context_eval.py` uses `--no-session`, so it cannot observe turn-to-turn decisions.

`run_context_multi_turn_eval.py` keeps a real session across turns inside a temp session directory so it can measure:
- whether compact happened on turn 1 vs turn 2
- whether follow-up/correction behaves differently from new-task handoff
- whether same-task next-phase still allows compact

## Current cases

1. `completed-task-follow-up-no-compact`
2. `completed-task-correction-no-compact`
3. `completed-task-new-task-should-compact`
4. `same-task-next-phase-can-compact`

## How to read results

Good behavior should look like this:
- turn 1: usually checkpoint, no compact
- turn 2 follow-up/correction: no compact
- turn 2 new unrelated task: compact
- turn 2 same-task next phase: compact allowed
