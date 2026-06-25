# Context Management Evals

This directory contains the **current active eval definitions** for the `context-management` skill.

Historical trigger-comparison outputs and old skill snapshots have been removed so this directory reflects the latest skill design only.

## Current eval sets

### 1. Trigger set
Files:
- `context-management-trigger-evals.json`
- `context-management-trigger-notes.md`

Purpose:
- verify whether the skill triggers at all on clearly positive and clearly negative prompts
- check coverage across search-heavy work, multi-phase work, retries/branches, repeated-item work, and interruption-prone work
- confirm it does **not** trigger on one-shot reads, direct rewrites, shallow bounded tasks, or conceptual discussion

### 2. Borderline set
Files:
- `context-management-borderline-evals.json`
- `context-management-borderline-notes.md`

Purpose:
- test whether the skill chooses the **right intensity** of action
- distinguish checkpoint-only vs timeline-first vs compact-worthy cases
- measure whether the agent escalates gradually instead of overreacting
- test repeated-item-vs-script workflow selection

### 3. Reference-routing set
Files:
- `context-management-ref-evals.json`
- `context-management-ref-notes.md`

Purpose:
- verify that the skill reads the **right scenario reference** for the task shape
- verify that retry / branch / pivot behavior causes an additional read of the cross-cutting retry reference when appropriate
- check whether the agent uses one primary ref instead of blindly loading everything

### 4. Natural-language set
Files:
- `context-management-natural-evals.json`
- `context-management-natural-notes.md`

Purpose:
- test whether the skill still triggers and routes correctly under more realistic user phrasing
- reduce dependence on prompts that explicitly hint at checkpoints, timeline, compact, or context-management concepts
- check whether search / browser reading / dev + retry / plan / repeated-items / cleanup are recognized from natural task wording

### 5. Natural actionable set
Files:
- `context-management-natural-actionable-evals.json`
- `context-management-natural-actionable-notes.md`

Purpose:
- test realistic user prompts that also provide enough concrete material to start real work immediately
- measure whether the agent actually takes a first structural action such as `context_checkpoint`
- check whether realistic actionable search / browser reading / plan / repeated-item / switching tasks route into the expected refs

### 6. Natural recognition set
Files:
- `context-management-natural-recognition-evals.json`
- `context-management-natural-recognition-notes.md`

Purpose:
- test whether the agent recognizes the right context-management mode even when the prompt still lacks enough concrete input to begin full execution
- evaluate these prompts by mode-signal evidence instead of requiring immediate tool invocation
- positive cases pass when the agent either uses context-management operationally with the expected scenario signal, reads the expected reference, or states a clear matching working mode

### 7. Multi-turn boundary set
Files:
- `context-management-multi-turn-evals.json`
- `context-management-multi-turn-notes.md`
- `run_context_multi_turn_eval.py`

Purpose:
- test behaviors that only appear across turns
- verify that the agent does **not** compact immediately after finishing a noisy task when the next user message is only a follow-up or correction
- verify that the agent **does** compact before starting a clearly different new task after a completed noisy task
- verify that same-task next-phase transitions can still compact when cleanup is actually useful

## Current skill hypothesis

The skill is designed to teach this working rhythm:
- checkpoint early and often
- review timeline when orientation matters
- compact only when a phase is ready to compact

The skill is **not** centered on file-backed durable state.

## What good behavior looks like

### Positive prompts
The agent should usually do one of these:
- proactively load/use the skill
- explicitly adopt the checkpoint / timeline / compact working mode
- choose an appropriate first action based on prompt shape

### Negative prompts
The agent should usually:
- answer directly
- avoid operational use of context tools
- avoid turning a bounded task into a long-running context-orchestration workflow

### Borderline prompts
The agent should show proportionality:
- **checkpoint-first** for large work just starting or interruption-prone work
- **timeline-first** when the main problem is disorientation or stale history
- **compact** when a noisy phase already produced a stable takeaway
- **no premature compact** when the thread is only mildly cluttered

For this skill, the most important behavioral question is not just whether it triggers, but whether it eventually performs `context_compact` in the right cases after establishing reasonable checkpoints.

## Suggested run matrix

When model access is available, compare at least:

1. `new_ext_new_skill`
2. `new_ext_no_skill`

If you still have older snapshots elsewhere, you can also compare:

3. `old_ext_old_skill`
4. `new_ext_old_skill`

## Runner

Use:

```bash
python evals/run_context_eval.py trigger
python evals/run_context_eval.py borderline
# or
python evals/run_context_eval.py all
```

For cross-turn behavior, use:

```bash
python evals/run_context_multi_turn_eval.py with-skill
# or
python evals/run_context_multi_turn_eval.py both
```

Notes:
- the runners temporarily remove installed `pi-context` from `~/.pi/agent/settings.json` while the run is active, so `with_skill` uses the local repo skill/extension and `no_skill` avoids the installed package leaking in
- single-turn outputs are written to `evals/run-<timestamp>-<set>/`
- multi-turn outputs are written to `evals/run-<timestamp>-multi-turn/`
- long runs may exceed shell time limits; if that happens, partial per-case outputs under the run directory are still useful
## Current known limitation

The default environment may still route some `no_skill` runs through other installed packages or provider behavior that knows about context tools indirectly. So the most trustworthy signal right now is:
- `with_skill` behavior quality
- per-case tool traces
- checkpoint vs timeline vs compact choice on positive cases

Treat absolute `no_skill` purity as approximate unless you also run in a cleaner Pi profile.

## Review dimensions

Score each run on:

1. **Trigger correctness**
2. **Action proportionality**
3. **Workflow selection quality**
4. **Concept-vs-operation separation**
5. **Checkpoint / timeline / compact choice quality**

## Current chosen description

See `context-management-description-candidates.md` for the active description and current evaluation focus.
