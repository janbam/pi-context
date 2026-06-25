#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EVALS_DIR = ROOT / "evals"
MULTI_TURN_FILE = EVALS_DIR / "context-management-multi-turn-evals.json"
HOME_PI_DIR = Path.home() / ".pi" / "agent"
SETTINGS_JSON = HOME_PI_DIR / "settings.json"
SKILL_PATH = str(ROOT / "skills")
EXT_FILES = [str(ROOT / "src" / "index.ts"), str(ROOT / "src" / "context.ts")]
SKILL_FILE_PATH = str(ROOT / "skills" / "context-management" / "SKILL.md")
REFERENCE_DIR = ROOT / "skills" / "context-management" / "references"
REFERENCE_PATHS = sorted(str(p) for p in REFERENCE_DIR.glob("*.md"))
CONTEXT_TOOLS = {"context_checkpoint", "context_timeline", "context_compact"}


@dataclass
class TurnResult:
    eval_set: str
    config: str
    case_id: str
    category: str
    turn_index: int
    query: str
    returncode: int
    used_context_tools: list[str]
    first_context_tool: str | None
    read_skill_file: bool
    read_reference_files: list[str]
    final_text: str
    error_message: str | None
    must_include_tools: list[str] | None = None
    must_not_include_tools: list[str] | None = None
    required_tools_correct: bool | None = None
    allowed_first_tools: list[str] | None = None
    first_tool_allowed: bool | None = None
    stdout_path: str | None = None
    stderr_path: str | None = None


@dataclass
class CaseSummary:
    eval_set: str
    config: str
    case_id: str
    category: str
    purpose: str
    turns: int
    case_pass: bool
    turn_passes: list[bool]
    compact_turns: list[int]
    checkpoint_turns: list[int]
    timeline_turns: list[int]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text())


@contextmanager
def patched_settings_without_installed_pi_context():
    backup = Path(tempfile.mkstemp(prefix="pi-context-settings-backup-", suffix=".json")[1])
    shutil.copy2(SETTINGS_JSON, backup)
    try:
        settings = json.loads(SETTINGS_JSON.read_text())
        settings["packages"] = [pkg for pkg in settings.get("packages", []) if pkg != "npm:pi-context"]
        SETTINGS_JSON.write_text(json.dumps(settings, ensure_ascii=False, indent=2))
        yield
    finally:
        shutil.copy2(backup, SETTINGS_JSON)
        backup.unlink(missing_ok=True)


def run_turn(query: str, with_skill: bool, session_dir: Path, continue_session: bool, out_dir: Path) -> tuple[int, str, str]:
    cmd = [
        "pi",
        "-p",
        "--mode",
        "json",
        "--session-dir",
        str(session_dir),
        "--no-context-files",
        "--no-skills",
        "-e",
        EXT_FILES[0],
        "-e",
        EXT_FILES[1],
    ]
    if continue_session:
        cmd.append("--continue")
    if with_skill:
        cmd.extend(["--skill", SKILL_PATH])
    cmd.append(query)

    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT), env=os.environ.copy())
    stdout_path = out_dir / "stdout.jsonl"
    stderr_path = out_dir / "stderr.txt"
    stdout_path.write_text(proc.stdout)
    stderr_path.write_text(proc.stderr)
    return proc.returncode, str(stdout_path), str(stderr_path)


def parse_jsonl_events(text: str) -> list[dict[str, Any]]:
    events = []
    for line in text.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            events.append(json.loads(line))
        except Exception:
            pass
    return events


def extract_final_text(events: list[dict[str, Any]]) -> str:
    for event in reversed(events):
        if event.get("type") == "agent_end":
            messages = event.get("messages", [])
            for msg in reversed(messages):
                if msg.get("role") != "assistant":
                    continue
                parts = []
                for c in msg.get("content", []):
                    if c.get("type") == "text":
                        parts.append(c.get("text", ""))
                if parts:
                    return "\n".join(parts).strip()
    return ""


def extract_error(events: list[dict[str, Any]]) -> str | None:
    for event in reversed(events):
        if event.get("type") == "turn_end":
            msg = event.get("message", {})
            return msg.get("errorMessage")
    return None


def detect_skill_read(events: list[dict[str, Any]], stdout_text: str) -> bool:
    if SKILL_FILE_PATH in stdout_text:
        return True
    for event in events:
        if event.get("type") == "tool_execution_start" and event.get("toolName") == "read":
            args = event.get("args", {})
            if args.get("path") == SKILL_FILE_PATH:
                return True
    return False


def detect_reference_reads(events: list[dict[str, Any]], stdout_text: str) -> list[str]:
    found = set()
    for ref in REFERENCE_PATHS:
        if ref in stdout_text:
            found.add(Path(ref).name)
    for event in events:
        if event.get("type") == "tool_execution_start" and event.get("toolName") == "read":
            args = event.get("args", {})
            path = args.get("path")
            if path in REFERENCE_PATHS:
                found.add(Path(path).name)
    return sorted(found)


def detect_context_tools(events: list[dict[str, Any]]) -> tuple[list[str], str | None]:
    used = []
    for event in events:
        if event.get("type") == "tool_execution_start":
            name = event.get("toolName")
            if name in CONTEXT_TOOLS:
                used.append(name)
    first = used[0] if used else None
    return used, first


def required_tools_check(turn: dict[str, Any], used_tools: list[str]) -> tuple[list[str] | None, list[str] | None, bool | None]:
    must_include = turn.get("must_include_tools")
    must_not_include = turn.get("must_not_include_tools")
    if not must_include and not must_not_include:
        return must_include, must_not_include, None
    used = set(used_tools)
    ok = True
    if must_include:
        ok = ok and all(t in used for t in must_include)
    if must_not_include:
        ok = ok and all(t not in used for t in must_not_include)
    return must_include, must_not_include, ok


def allowed_first_tool_check(turn: dict[str, Any], first_tool: str | None) -> tuple[list[str] | None, bool | None]:
    allowed = turn.get("allowed_first_tools")
    if not allowed:
        return None, None
    return allowed, first_tool in allowed


def run_eval_set(cases: list[dict[str, Any]], out_root: Path, config_name: str, with_skill: bool) -> tuple[list[TurnResult], list[CaseSummary]]:
    turn_results: list[TurnResult] = []
    case_summaries: list[CaseSummary] = []
    for idx, case in enumerate(cases, start=1):
        case_id = str(case.get("id", idx))
        category = case.get("category", "multi-turn")
        case_dir = out_root / config_name / f"case-{case_id}"
        session_dir = case_dir / "session"
        session_dir.mkdir(parents=True, exist_ok=True)
        per_turn_passes = []
        compact_turns = []
        checkpoint_turns = []
        timeline_turns = []

        for turn_index, turn in enumerate(case["turns"], start=1):
            turn_dir = case_dir / f"turn-{turn_index}"
            turn_dir.mkdir(parents=True, exist_ok=True)
            returncode, stdout_path, stderr_path = run_turn(
                query=turn["query"],
                with_skill=with_skill,
                session_dir=session_dir,
                continue_session=(turn_index > 1),
                out_dir=turn_dir,
            )
            stdout_text = Path(stdout_path).read_text()
            events = parse_jsonl_events(stdout_text)
            error_message = extract_error(events)
            used_tools, first_tool = detect_context_tools(events)
            final_text = extract_final_text(events)
            read_skill = detect_skill_read(events, stdout_text)
            read_refs = detect_reference_reads(events, stdout_text)
            must_include, must_not_include, required_tools_ok = required_tools_check(turn, used_tools)
            allowed_first_tools, first_tool_allowed = allowed_first_tool_check(turn, first_tool)
            turn_pass = True
            if required_tools_ok is False:
                turn_pass = False
            if first_tool_allowed is False:
                turn_pass = False
            per_turn_passes.append(turn_pass)
            if "context_compact" in used_tools:
                compact_turns.append(turn_index)
            if "context_checkpoint" in used_tools:
                checkpoint_turns.append(turn_index)
            if "context_timeline" in used_tools:
                timeline_turns.append(turn_index)

            result = TurnResult(
                eval_set="multi-turn",
                config=config_name,
                case_id=case_id,
                category=category,
                turn_index=turn_index,
                query=turn["query"],
                returncode=returncode,
                used_context_tools=used_tools,
                first_context_tool=first_tool,
                read_skill_file=read_skill,
                read_reference_files=read_refs,
                final_text=final_text,
                error_message=error_message,
                must_include_tools=must_include,
                must_not_include_tools=must_not_include,
                required_tools_correct=required_tools_ok,
                allowed_first_tools=allowed_first_tools,
                first_tool_allowed=first_tool_allowed,
                stdout_path=stdout_path,
                stderr_path=stderr_path,
            )
            (turn_dir / "summary.json").write_text(json.dumps(asdict(result), ensure_ascii=False, indent=2))
            turn_results.append(result)

        case_summary = CaseSummary(
            eval_set="multi-turn",
            config=config_name,
            case_id=case_id,
            category=category,
            purpose=case.get("purpose", ""),
            turns=len(case["turns"]),
            case_pass=all(per_turn_passes),
            turn_passes=per_turn_passes,
            compact_turns=compact_turns,
            checkpoint_turns=checkpoint_turns,
            timeline_turns=timeline_turns,
        )
        (case_dir / "case-summary.json").write_text(json.dumps(asdict(case_summary), ensure_ascii=False, indent=2))
        case_summaries.append(case_summary)
    return turn_results, case_summaries


def write_summary(turn_results: list[TurnResult], case_summaries: list[CaseSummary], out_root: Path) -> None:
    by_config: dict[str, dict[str, Any]] = {}
    for cs in case_summaries:
        data = by_config.setdefault(cs.config, {
            "cases": 0,
            "cases_pass": 0,
            "turns": 0,
            "turns_pass": 0,
            "compact_cases": 0,
            "checkpoint_cases": 0,
            "timeline_cases": 0,
        })
        data["cases"] += 1
        data["turns"] += cs.turns
        data["turns_pass"] += sum(1 for p in cs.turn_passes if p)
        if cs.case_pass:
            data["cases_pass"] += 1
        if cs.compact_turns:
            data["compact_cases"] += 1
        if cs.checkpoint_turns:
            data["checkpoint_cases"] += 1
        if cs.timeline_turns:
            data["timeline_cases"] += 1

    (out_root / "turn-results.json").write_text(json.dumps([asdict(r) for r in turn_results], ensure_ascii=False, indent=2))
    (out_root / "case-summaries.json").write_text(json.dumps([asdict(c) for c in case_summaries], ensure_ascii=False, indent=2))
    (out_root / "aggregates.json").write_text(json.dumps(by_config, ensure_ascii=False, indent=2))

    lines = [
        f"# Context Management Multi-turn Eval Run ({datetime.now().isoformat(timespec='seconds')})",
        "",
        "## Summary",
        "",
        "| config | cases | case pass | case pass rate | turns | turn pass | turn pass rate | checkpoint cases | timeline cases | compact cases |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for config, data in sorted(by_config.items()):
        lines.append(
            f"| {config} | {data['cases']} | {data['cases_pass']} | {data['cases_pass'] / data['cases']:.2%} | {data['turns']} | {data['turns_pass']} | {data['turns_pass'] / data['turns']:.2%} | {data['checkpoint_cases']} | {data['timeline_cases']} | {data['compact_cases']} |"
        )
    lines.extend(["", "## Cases", ""])
    for cs in case_summaries:
        lines.append(f"### {cs.config}/case-{cs.case_id} ({cs.category})")
        lines.append(f"- purpose: {cs.purpose}")
        lines.append(f"- case_pass: {cs.case_pass}")
        lines.append(f"- turn_passes: {cs.turn_passes}")
        lines.append(f"- checkpoint_turns: {cs.checkpoint_turns}")
        lines.append(f"- timeline_turns: {cs.timeline_turns}")
        lines.append(f"- compact_turns: {cs.compact_turns}")
        lines.append("")
    lines.extend(["## Turn failures", ""])
    for tr in turn_results:
        if tr.required_tools_correct is False or tr.first_tool_allowed is False:
            lines.append(f"### {tr.config}/case-{tr.case_id}/turn-{tr.turn_index}")
            lines.append(f"- used_context_tools: {tr.used_context_tools}")
            lines.append(f"- first_context_tool: {tr.first_context_tool}")
            if tr.must_include_tools or tr.must_not_include_tools:
                lines.append(f"- must_include_tools: {tr.must_include_tools}")
                lines.append(f"- must_not_include_tools: {tr.must_not_include_tools}")
                lines.append(f"- required_tools_correct: {tr.required_tools_correct}")
            if tr.allowed_first_tools:
                lines.append(f"- allowed_first_tools: {tr.allowed_first_tools}")
                lines.append(f"- first_tool_allowed: {tr.first_tool_allowed}")
            preview = tr.final_text.replace("\n", " ")
            if len(preview) > 240:
                preview = preview[:240] + "..."
            if preview:
                lines.append(f"- final_text: {preview}")
            if tr.error_message:
                lines.append(f"- error: {tr.error_message}")
            lines.append("")
    (out_root / "summary.md").write_text("\n".join(lines))


def main() -> int:
    cases = load_json(MULTI_TURN_FILE)
    args = sys.argv[1:]
    mode = args[0] if args else "with-skill"
    if mode not in {"with-skill", "both", "no-skill"}:
        raise SystemExit("usage: run_context_multi_turn_eval.py [with-skill|both|no-skill]")

    run_stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_root = EVALS_DIR / f"run-{run_stamp}-multi-turn"
    out_root.mkdir(parents=True, exist_ok=True)

    configs: list[tuple[str, bool]] = []
    if mode in {"with-skill", "both"}:
        configs.append(("with_skill", True))
    if mode in {"no-skill", "both"}:
        configs.append(("no_skill", False))

    all_turn_results: list[TurnResult] = []
    all_case_summaries: list[CaseSummary] = []
    with patched_settings_without_installed_pi_context():
        for config_name, with_skill in configs:
            turn_results, case_summaries = run_eval_set(cases, out_root, config_name, with_skill)
            all_turn_results.extend(turn_results)
            all_case_summaries.extend(case_summaries)

    write_summary(all_turn_results, all_case_summaries, out_root)
    print(out_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
