# Multi-turn net-benefit eval notes

## Decision under test

A phase label, task switch, review wait, or fresh checkpoint is **not** sufficient reason to compact. Compare the removable stale segment with the cost of compaction, losing still-live detail, and rereading it during the remaining work. A short unrelated question can be cheaper to answer directly. A long cold segment followed by substantial work can justify compaction even within the same task.

Cases 5–10 test this decision without asking for compaction. Cases 9–10 explicitly establish checkpoints to control anchor placement, **not** to request compaction. Case 4 is a separate explicit-user-override control and must not count as evidence of autonomous net-benefit judgment.

## Executable setup

`run_context_multi_turn_eval.py` runs from the repository root and retains a real session between turns of each case. Its two supported configs are `with-skill` and `no-skill` (or `both`). Read alongside `evals/README.md` for the run matrix and broader evaluation scope.

Cases 1–4 read existing repository documents or `package.json`. Cases 5–10 create their own deterministic fixtures in uniquely allocated system temporary directories using Python standard-library `tempfile.mkdtemp`. Prompts require absolute paths in the first answer so continued turns can find the artifacts. All code, mutated test copies, tests, and reports for these cases stay inside that case's temporary directory. No repository changes, deployments, network requests, private historical identifiers, or external data are needed. Use `python3` where `python` is unavailable. Do not run the fixtures against production data.

Large fixtures are deliberate: audit data is read in three 200-row chunks, and closed monitoring in six 100-line chunks. Inspect traces for complete reads, not just an agent assertion that the data was read. If the setup is skipped or truncated, the intended cold/live context contrast was not established; do not interpret that run as a valid compaction-choice result. Temporary files may remain after a run; the runner does not clean model-created fixture directories. Remove only verified case-owned directories after inspecting results.

## Cases and tool expectations

| ID | Scenario | Turn 1 | Turn 2 |
|---|---|---|---|
| 1 | Completed noisy research → refinement | checkpoint, no compact | no compact |
| 2 | Completed noisy research → correction | checkpoint, no compact | no compact |
| 3 | Completed noisy research → tiny unrelated `package.json` question | checkpoint, no compact | no compact: short remaining horizon |
| 4 | Explicit user request to compact research before planning | checkpoint, no compact | compact: **override control only** |
| 5 | Research → verification, high raw overlap | checkpoint, no compact | no compact: all 600 original rows still under verification |
| 6 | Same research → verification label, low raw overlap | checkpoint, no compact | compact: small summary suffices for multi-step planner work |
| 7 | Review wait with immediately needed patch and failing tests | no compact | no compact: patch and diagnostics remain hot |
| 8 | Review wait after accumulated closed monitoring | checkpoint, no compact | compact: carry summary into multi-step capacity simulation |
| 9 | Fresh checkpoint after reading the needed script | checkpoint, no compact | no compact: no meaningful stale segment |
| 10 | Script checkpoint followed by substantial closed monitoring | checkpoint, no compact | compact: remove monitoring, preserve script continuation |

Cases 5 and 6 have identical first-turn queries and the same phase-boundary wording. Their difference is raw-detail reuse versus summary-only continuation. Cases 7 and 8 both wait for review, but differ in raw segment temperature, size, and remaining work: they are a contrast, not a single-variable experiment. Cases 9 and 10 have identical second-turn queries; case 10 adds genuinely stale observations after the script anchor. The formulas make business results reproducible; the raw fixture reads establish the context load rather than relying on a claim that earlier work was noisy.

Turn 1 intentionally stops after setup/research or diagnosis, with no compaction requested or expected. Turn 2 provides the information needed to choose whether cleanup pays off. For positive autonomous cases, the first **context** tool may be timeline or compact, not a redundant fresh checkpoint. This does not forbid normal tools before that call; see runner limitations below.

## Business-output oracle (manual, required alongside tool scores)

A context-tool pass alone is not task success. Inspect each turn's `summary.json` (`final_text`, `returncode`, `error_message`) and `stdout.jsonl`, plus the retained temporary artifacts. Require actual execution evidence, not merely plausible numbers in prose.

- **1:** Research answer identifies net benefit/removable stale content, live-detail reuse, and remaining work as relevant; the follow-up gives exactly three shorter rules consistent with that answer.
- **2:** The second answer actually revises its prior second point into an executable instruction, without changing topic or inventing an unrelated policy.
- **3:** The answer lists the current `package.json` scripts and accurately explains their actual commands. Use the checked-out file as the oracle, not a frozen list of script names.
- **4:** The final plan names existing relevant documentation files and describes concrete changes grounded in the research. A compact call with no useful continuation plan fails the business rubric.
- **5–6, turn 1:** `summary.json` and the answer report 600 rows, total amount 2700, blocked 60. Each of alpha/beta/gamma has 200 rows, amount 900, blocked 20 (180 ready). Confirm the absolute fixture directory exists and all 600 rows were inspected.
- **5, turn 2:** Original CSV passes all 600 rows. Three independent corrupted copies fail at `(120, detail)`, `(240, status)`, and `(360, lane)` respectively. `gamma` is deliberately different from row 360's original `alpha`. The verifier must compare the full detail string, not just IDs or totals; the original CSV must remain unchanged.
- **6, turn 2:** Six named test categories actually run and pass. `plans.json` contains capacity 1 through 20, with per-lane results and independently checked conservation. At capacity 10: 54 total boxes, last box 10 per lane. At 16: 36 total boxes, last box 4 per lane. At 20: 27 total boxes, last box 20 per lane. Empty/zero-ready lanes have zero boxes; reject nonpositive capacity rather than divide by zero.
- **7:** Turn 1's test run genuinely fails only the equality boundary, and proposes `>=`. Turn 2 applies that minimal function change inside the fixture, shows the diff, and all six specified tests pass. Do not treat the intentionally failing nested test subprocess in turn 1 as an agent-run failure if it is correctly diagnosed.
- **8, turn 1 / 10, turn 1:** Monitoring summary is samples=600, max_queue=4, errors_total=0. Full monitoring is read before the final summary; there are no unresolved incidents to preserve.
- **9–10, turn 1:** `drain([2,5,0,4],3)` returns queue=1, peak=2, done=10. Peak is measured **after processing** each tick. Trace must place the requested checkpoint after reading the script; in case 10 it must precede the monitoring reads.
- **8–10, turn 2:** All six specified test categories pass and an independent reference calculation agrees for capacities 1 through 6. `drain-results.json` covers all six capacities for `[2,5,0,4] * 20` (220 total arrivals). At capacity 2: queue=60, peak=60, done=160. At capacity 3: queue=1, peak=2, done=219. Final answers include these results and artifact paths; case 8 also retains the monitoring summary. Require `queue + done == 220` for every simulation, not just the two displayed cases.

For positive cases, also inspect compaction **success and target**: the selected anchor must actually remove the bulky stale segment; the continuation summary must preserve fixture paths, stable conclusions, remaining requirements, and any needed script state. Compacting to a checkpoint after the cold data, losing the directory path, or immediately reloading all discarded cold detail is not the intended success. For negative cases, inspect whether the agent completes the work directly rather than substituting a prose discussion of context management.

## Runner limits and interpretation

The existing runner was inspected; no framework changes are part of this revision.

- Supported turn assertions are `must_include_tools`, `must_not_include_tools`, and `allowed_first_tools`. There is **no `output_contains` support**; adding such a field would silently fail to check business output. This set therefore uses only supported assertion keys and supplies the manual oracle above.
- `allowed_first_tools` checks the first context tool, not the first tool overall. Tool presence is collected from execution-start events; it does not prove successful compaction, correct anchor selection, or that cleanup occurred before substantive work.
- The print-mode runner can exit after the extension aborts the current loop, before deferred branch creation and continuation complete. This was observed in the GPT-6 paired run: exit code 0 and a recorded compact call, but no `branch_summary` in the session and an assistant `This operation was aborted` error. Such runs measure attempted decisions only; they cannot validate post-compact business output, recovery costs, or successful cleanup. Use a persistent lifecycle (as in the existing RPC live integration test) for those checks.
- `case_pass` currently reflects only these tool assertions. It does not fail automatically for a nonzero return code, an error message, missing output, wrong numbers, or an unexecuted fixture. Report tool score and business/trace review separately; do not advertise aggregate `case_pass` as end-to-end correctness.
- Positive cases deliberately provide substantial removable text and multi-step continuation, but no fixed token threshold is asserted. If the observed trace has little removable context or expensive rereads, inspect whether the setup ran as specified and whether the fixture/expectation needs calibration rather than using a phase label as the explanation.

Static validation should parse the JSON, verify IDs and supported assertion keys, check paired query equality, confirm referenced repository files exist, and independently calculate fixture oracles. Model eval runs are a separate, explicitly launched validation step; merely loading this JSON does not execute them.
