# Context Management Trigger Notes

This file explains why each query in `evals/context-management-trigger-evals.json` should or should not trigger the `context-management` skill.

The current skill is optimized around a working rhythm of:
- frequent checkpoints
- periodic timeline review
- targeted compactions once a phase is ready to compact

It is **not** primarily about file-backed task state.

## Should Trigger

### 1. Customer cases with representative research
**Query:** Many customer cases; research one representative case, derive a handling pattern, then process the rest.

**Why it should trigger:**
- repeated-item work across many turns
- representative-case learning followed by repeated execution
- high chance of thread growth and per-item noise
- checkpoint/compact discipline is central to staying clean

### 2. Bug investigation with lots of code and logs
**Query:** Read lots of code and logs; decide when to checkpoint and revisit timeline.

**Why it should trigger:**
- long search-heavy debugging path
- user explicitly asks for autonomous context management
- likely to produce lots of low-density tool output

### 3. Understand the call chain first, preserve only conclusions
**Query:** Research call chain across many files; only keep key conclusions and next-step plan.

**Why it should trigger:**
- noisy research process with compact desired output
- strong fit for checkpoint + compact after a stable finding

### 4. Multi-phase migration across 12 services
**Query:** Inventory, migration plan, phased updates, regression validation; proactively do checkpoints and timeline review.

**Why it should trigger:**
- classic multi-phase workflow
- natural milestones and phase boundaries
- explicit need for anchors between phases

### 5. Ticket queue with sample-first workflow
**Query:** Many similar tickets; study one sample, then process sequentially.

**Why it should trigger:**
- repeated-item workflow over many turns
- likely to benefit from a stable repeated-work anchor
- per-item raw paths should not all remain active

### 6. Try A/B/C without polluting main line
**Query:** Explore multiple approaches; failed paths should not pollute the main thought process.

**Why it should trigger:**
- direct fit for retry-from-anchor behavior
- main value is compacting failed branches into useful lessons

### 7. Conversation already long; keep only what matters next
**Query:** Long conversation, more implementation/testing ahead; manage context and retain only useful next-step info.

**Why it should trigger:**
- direct request for proactive context management
- the problem is already history pollution

### 8. Research a release flow, derive a reusable method, process repeated items
**Query:** Learn the release workflow, turn it into a reusable method, then execute many release orders.

**Why it should trigger:**
- repeated-item workflow with upfront exploration
- strong need for checkpoints and periodic cleanup between items

### 9. Study a problem across multiple directories and decide when to anchor/compress
**Query:** Research across api/, worker/, scheduler/, docs/; agent decides when to create anchors and compress.

**Why it should trigger:**
- cross-cutting investigation across many files
- explicit request for autonomous checkpoint and compact decisions

### 10. Iterate while studying and trialing paths; compress failed routes
**Query:** Not a one-shot implementation; when a route fails, compress failure and return to stable point.

**Why it should trigger:**
- exact fit for branch/retry compaction behavior
- high need for preserving lessons while clearing stale path detail

### 11. Long-chain troubleshooting with logs and invalid attempts
**Query:** Collect clues, find root cause, propose fix, validate; lots of logs and invalid attempts expected.

**Why it should trigger:**
- long, noisy, multi-stage workflow
- strong need for checkpoints between evidence gathering, diagnosis, fix, and validation

### 12. Interruption-prone main task
**Query:** Main task may be interrupted by temporary subtasks; establish pause points so the main line can be resumed cleanly.

**Why it should trigger:**
- subtask switching is a first-class scenario in the current skill design
- checkpoints are useful even before the first interruption happens

### 13. Big change starting now; establish a stable start point first
**Query:** Large change is about to begin; create a stable start point and escalate later if needed.

**Why it should trigger:**
- positive case for lightweight early usage
- should usually start with checkpoint-first behavior rather than heavy compaction

## Should Not Trigger

### 14. One-file summary
**Query:** Briefly summarize `src/index.ts`.

**Why it should not trigger:**
- simple one-shot reading task
- no multi-phase workflow and no need for history structure

### 15. Straightforward TS-to-Python rewrite
**Query:** Rewrite TypeScript to Python with same functionality.

**Why it should not trigger:**
- normal code transformation task
- not inherently about context management unless it expands later

### 16. Explain the tool conceptually
**Query:** Explain what `context_compact` means with a simple example.

**Why it should not trigger:**
- pure concept explanation
- the topic matches, but the workflow does not

### 17. Single quick production error triage
**Query:** One online error, quickly inspect stack trace and suggest likely issue.

**Why it should not trigger:**
- short diagnostic task
- may escalate later, but not by default

### 18. Translate README
**Query:** Translate Chinese README to English.

**Why it should not trigger:**
- straightforward writing task
- no long-running search, branching, or phase structure

### 19. Search common causes of an error online
**Query:** Search web for common causes of an error; no code changes needed.

**Why it should not trigger:**
- research-like but still shallow and bounded
- not enough evidence yet that explicit history management is needed

### 20. Fixed-rule batch script
**Query:** 40 records need fixing, but the rule is already fully defined; just write a script.

**Why it should not trigger:**
- direct automation is the right move
- many items alone is not sufficient

### 21. Bounded multi-file architecture summary
**Query:** Read package.json, README, and src/index.ts, then summarize the plugin design.

**Why it should not trigger:**
- multi-file but still bounded and summary-oriented
- should avoid over-triggering on every multi-file read

### 22. Planning outline only
**Query:** Give a troubleshooting plan outline only; do not execute it.

**Why it should not trigger:**
- planning-only request
- no active long-running workflow yet

### 23. Methodology discussion only
**Query:** Give a practical guide for managing long conversations, but do not actually operate tools.

**Why it should not trigger:**
- conceptual discussion of the mode
- should not operationally trigger the mode itself

## Borderline themes to watch

These are the main places where tuning matters now:

1. **Multi-file but still bounded reading**
   - The skill should not trigger just because several files are involved.

2. **Medium debugging that may escalate later**
   - The agent should be able to start light and switch modes only when the thread begins to grow.

3. **Repeated-item work vs direct automation**
   - Trigger when there is per-item reasoning or representative-case learning.
   - Skip when the task is already a fixed-rule scripting problem.

4. **Concept discussion vs operational execution**
   - Talking about checkpoint/timeline/compact should not automatically invoke them.

5. **Tool-intensity proportionality**
   - Some positives should imply checkpoint-only.
   - Some should imply timeline-first.
   - Some should imply compact.
