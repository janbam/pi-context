#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EVALS_DIR = ROOT / "evals"
TRIGGER_FILE = EVALS_DIR / "context-management-trigger-evals.json"
BORDERLINE_FILE = EVALS_DIR / "context-management-borderline-evals.json"
REF_FILE = EVALS_DIR / "context-management-ref-evals.json"
NATURAL_FILE = EVALS_DIR / "context-management-natural-evals.json"
NATURAL_ACTIONABLE_FILE = EVALS_DIR / "context-management-natural-actionable-evals.json"
NATURAL_RECOGNITION_FILE = EVALS_DIR / "context-management-natural-recognition-evals.json"
HOME_PI_DIR = Path.home() / ".pi" / "agent"
SETTINGS_JSON = HOME_PI_DIR / "settings.json"
AUTH_JSON = HOME_PI_DIR / "auth.json"
SKILL_PATH = str(ROOT / "skills")
EXT_FILES = [str(ROOT / "src" / "index.ts"), str(ROOT / "src" / "context.ts")]
SKILL_FILE_PATH = str(ROOT / "skills" / "context-management" / "SKILL.md")
REFERENCE_DIR = ROOT / "skills" / "context-management" / "references"
REFERENCE_PATHS = sorted(str(p) for p in REFERENCE_DIR.glob("*.md"))
CONTEXT_TOOLS = {"context_checkpoint", "context_timeline", "context_compact"}
CONTEXT_MODE_MARKERS = [
    "context", "checkpoint", "timeline", "compact",
    "上下文", "会话", "检查点", "锚点", "时间线", "压缩", "回到干净", "续上",
]
MODE_SIGNAL_REFS = {
    "search-research-and-reading": "search-research-and-reading.md",
    "development-and-troubleshooting": "development-and-troubleshooting.md",
    "retry-branch-and-pivot": "retry-branch-and-pivot.md",
    "planning-and-execution": "planning-and-execution.md",
    "repeated-items-and-batch-work": "repeated-items-and-batch-work.md",
    "task-switching-and-cleanup": "task-switching-and-cleanup.md",
}
MODE_SIGNAL_ALIASES = {
    "search-research-and-reading": [
        "search", "research", "reading", "browser", "web", "搜", "搜索", "研究", "阅读", "网页", "资料", "文档", "页面",
    ],
    "development-and-troubleshooting": [
        "development", "troubleshooting", "debug", "bug", "code", "implement", "开发", "排障", "调试", "代码", "实现", "修复",
    ],
    "retry-branch-and-pivot": [
        "retry", "branch", "pivot", "attempt", "approach", "重试", "分支", "尝试", "路线", "方向", "失败路径", "切换",
    ],
    "planning-and-execution": [
        "plan", "todo", "execution", "roadmap", "计划", "步骤", "执行", "清单", "拆", "推进",
    ],
    "repeated-items-and-batch-work": [
        "repeated", "batch", "item", "sample", "case", "批", "样本", "套路", "逐个", "一条条", "重复", "同样",
    ],
    "task-switching-and-cleanup": [
        "switch", "cleanup", "pause", "resume", "interrupt", "切换", "清理", "暂停", "恢复", "打断", "插入", "主线", "续上",
    ],
}


@dataclass
class RunResult:
    eval_set: str
    config: str
    case_id: str
    category: str
    query: str
    should_trigger: bool
    returncode: int
    used_context_tools: list[str]
    first_context_tool: str | None
    read_skill_file: bool
    read_reference_files: list[str]
    final_text: str
    error_message: str | None
    trigger_correct: bool
    expected_refs: list[str] | None = None
    required_refs_correct: bool | None = None
    intensity_expected: str | None = None
    intensity_correct: bool | None = None
    must_include_tools: list[str] | None = None
    must_not_include_tools: list[str] | None = None
    required_tools_correct: bool | None = None
    allowed_first_tools: list[str] | None = None
    first_tool_allowed: bool | None = None
    expected_mode_signal: str | None = None
    mode_signal_correct: bool | None = None
    stdout_path: str | None = None
    stderr_path: str | None = None


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


def run_case(query: str, with_skill: bool, out_dir: Path) -> tuple[int, str, str]:
    cmd = [
        "pi",
        "-p",
        "--mode",
        "json",
        "--no-session",
        "--no-context-files",
        "--no-skills",
        "-e",
        EXT_FILES[0],
        "-e",
        EXT_FILES[1],
    ]
    if with_skill:
        cmd.extend(["--skill", SKILL_PATH])
    cmd.append(query)

    env = os.environ.copy()
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=str(ROOT))
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
        if event.get("type") == "tool_execution_start":
            if event.get("toolName") == "read":
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


def intensity_expectation(case: dict[str, Any]) -> str | None:
    expected = (case.get("expected_behavior") or "").lower()
    if "checkpoint" in expected and "timeline" not in expected and "compact" not in expected:
        return "context_checkpoint"
    if "timeline first" in expected or "prefer context_timeline" in expected:
        return "context_timeline"
    if "strong compact" in expected or "context_compact" in expected:
        return "context_compact"
    return None


def required_tools_check(case: dict[str, Any], used_tools: list[str]) -> tuple[list[str] | None, list[str] | None, bool | None]:
    must_include = case.get("must_include_tools")
    must_not_include = case.get("must_not_include_tools")
    if not must_include and not must_not_include:
        return must_include, must_not_include, None
    used = set(used_tools)
    ok = True
    if must_include:
        ok = ok and all(t in used for t in must_include)
    if must_not_include:
        ok = ok and all(t not in used for t in must_not_include)
    return must_include, must_not_include, ok


def expected_refs_check(case: dict[str, Any], read_reference_files: list[str]) -> tuple[list[str] | None, bool | None]:
    expected = case.get("expected_refs")
    if not expected:
        return None, None
    read_set = set(read_reference_files)
    ok = all(ref in read_set for ref in expected)
    return expected, ok


def allowed_first_tool_check(case: dict[str, Any], first_tool: str | None) -> tuple[list[str] | None, bool | None]:
    allowed = case.get("allowed_first_tools")
    if not allowed:
        return None, None
    return allowed, first_tool in allowed


def mode_signal_check(case: dict[str, Any], final_text: str, used_tools: list[str], read_skill: bool, read_refs: list[str]) -> tuple[str | None, bool | None]:
    expected = case.get("expected_mode_signal")
    if not expected:
        return None, None

    # Natural-recognition cases may pass without immediate tool invocation, but
    # they still need evidence of the expected working mode. Operational evidence
    # (tool/skill/ref usage) can prove context-management recognition; expected
    # reference reads or final-text aliases prove the specific scenario mode.
    text = final_text.lower()
    has_context_marker = bool(used_tools or read_skill or read_refs) or any(marker.lower() in text for marker in CONTEXT_MODE_MARKERS)
    expected_parts = [part.strip() for part in expected.split("+")]
    mode_matches = []
    for part in expected_parts:
        expected_ref = MODE_SIGNAL_REFS.get(part)
        aliases = MODE_SIGNAL_ALIASES.get(part, [part])
        mode_matches.append(
            (expected_ref in read_refs if expected_ref else False)
            or any(alias.lower() in text for alias in aliases)
        )

    return expected, has_context_marker and all(mode_matches)


def trigger_check(eval_name: str, case: dict[str, Any], used_tools: list[str], read_skill: bool, read_refs: list[str], mode_signal_ok: bool | None) -> bool:
    should_trigger = bool(case["should_trigger"])
    if eval_name != "natural-recognition":
        return (len(used_tools) > 0) == should_trigger

    if should_trigger:
        return bool(mode_signal_ok)

    # Negative recognition cases should stay non-operational. Reading the skill
    # or refs is considered over-triggering even if no context tool is called.
    return not used_tools and not read_skill and not read_refs


def run_eval_set(eval_name: str, cases: list[dict[str, Any]], out_root: Path) -> list[RunResult]:
    results: list[RunResult] = []
    configs = [("with_skill", True)] if eval_name == "ref" else [("with_skill", True), ("no_skill", False)]
    for config, with_skill in configs:
        for idx, case in enumerate(cases, start=1):
            case_id = str(case.get("id", idx))
            category = case.get("category", "trigger")
            case_dir = out_root / eval_name / config / f"case-{case_id}"
            case_dir.mkdir(parents=True, exist_ok=True)
            returncode, stdout_path, stderr_path = run_case(case["query"], with_skill, case_dir)
            stdout_text = Path(stdout_path).read_text()
            events = parse_jsonl_events(stdout_text)
            error_message = extract_error(events)
            used_tools, first_tool = detect_context_tools(events)
            final_text = extract_final_text(events)
            read_skill = detect_skill_read(events, stdout_text)
            read_refs = detect_reference_reads(events, stdout_text)
            expected_mode_signal, mode_signal_correct = mode_signal_check(case, final_text, used_tools, read_skill, read_refs)
            trigger_correct = trigger_check(eval_name, case, used_tools, read_skill, read_refs, mode_signal_correct)
            expected_intensity = intensity_expectation(case) if eval_name == "borderline" else None
            intensity_correct = None
            if expected_intensity:
                intensity_correct = first_tool == expected_intensity
            must_include_tools, must_not_include_tools, required_tools_ok = required_tools_check(case, used_tools)
            expected_refs, required_refs_ok = expected_refs_check(case, read_refs)
            allowed_first_tools, first_tool_allowed = allowed_first_tool_check(case, first_tool)
            result = RunResult(
                eval_set=eval_name,
                config=config,
                case_id=case_id,
                category=category,
                query=case["query"],
                should_trigger=bool(case["should_trigger"]),
                returncode=returncode,
                used_context_tools=used_tools,
                first_context_tool=first_tool,
                read_skill_file=read_skill,
                read_reference_files=read_refs,
                final_text=final_text,
                error_message=error_message,
                trigger_correct=trigger_correct,
                expected_refs=expected_refs,
                required_refs_correct=required_refs_ok,
                intensity_expected=expected_intensity,
                intensity_correct=intensity_correct,
                must_include_tools=must_include_tools,
                must_not_include_tools=must_not_include_tools,
                required_tools_correct=required_tools_ok,
                allowed_first_tools=allowed_first_tools,
                first_tool_allowed=first_tool_allowed,
                expected_mode_signal=expected_mode_signal,
                mode_signal_correct=mode_signal_correct,
                stdout_path=stdout_path,
                stderr_path=stderr_path,
            )
            (case_dir / "summary.json").write_text(json.dumps(asdict(result), ensure_ascii=False, indent=2))
            results.append(result)
    return results


def summarize(results: list[RunResult]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for eval_set in sorted({r.eval_set for r in results}):
        summary[eval_set] = {}
        for config in sorted({r.config for r in results if r.eval_set == eval_set}):
            subset = [r for r in results if r.eval_set == eval_set and r.config == config]
            trigger_pass = sum(1 for r in subset if r.trigger_correct)
            data = {
                "cases": len(subset),
                "trigger_pass": trigger_pass,
                "trigger_pass_rate": round(trigger_pass / len(subset), 4) if subset else 0,
                "tool_usage": {tool: sum(tool in r.used_context_tools for r in subset) for tool in sorted(CONTEXT_TOOLS)},
            }
            intensity_subset = [r for r in subset if r.intensity_expected is not None]
            if intensity_subset:
                intensity_pass = sum(1 for r in intensity_subset if r.intensity_correct)
                data["intensity_cases"] = len(intensity_subset)
                data["intensity_pass"] = intensity_pass
                data["intensity_pass_rate"] = round(intensity_pass / len(intensity_subset), 4)
            ref_subset = [r for r in subset if r.required_refs_correct is not None]
            if ref_subset:
                ref_pass = sum(1 for r in ref_subset if r.required_refs_correct)
                data["ref_cases"] = len(ref_subset)
                data["ref_pass"] = ref_pass
                data["ref_pass_rate"] = round(ref_pass / len(ref_subset), 4)
                counts = {}
                for r in ref_subset:
                    for ref in r.read_reference_files:
                        counts[ref] = counts.get(ref, 0) + 1
                data["reference_usage"] = counts
            required_subset = [r for r in subset if r.required_tools_correct is not None]
            if required_subset:
                required_pass = sum(1 for r in required_subset if r.required_tools_correct)
                data["required_tool_cases"] = len(required_subset)
                data["required_tool_pass"] = required_pass
                data["required_tool_pass_rate"] = round(required_pass / len(required_subset), 4)
            first_subset = [r for r in subset if r.first_tool_allowed is not None]
            if first_subset:
                first_pass = sum(1 for r in first_subset if r.first_tool_allowed)
                data["allowed_first_tool_cases"] = len(first_subset)
                data["allowed_first_tool_pass"] = first_pass
                data["allowed_first_tool_pass_rate"] = round(first_pass / len(first_subset), 4)
            mode_signal_subset = [r for r in subset if r.mode_signal_correct is not None]
            if mode_signal_subset:
                mode_signal_pass = sum(1 for r in mode_signal_subset if r.mode_signal_correct)
                data["mode_signal_cases"] = len(mode_signal_subset)
                data["mode_signal_pass"] = mode_signal_pass
                data["mode_signal_pass_rate"] = round(mode_signal_pass / len(mode_signal_subset), 4)
            summary[eval_set][config] = data
    return summary


def write_markdown(results: list[RunResult], summary: dict[str, Any], out_root: Path) -> None:
    lines = [
        f"# Context Management Eval Run ({datetime.now().isoformat(timespec='seconds')})",
        "",
        "## Summary",
        "",
    ]
    for eval_set, configs in summary.items():
        lines.append(f"### {eval_set}")
        lines.append("")
        lines.append("| config | cases | trigger pass | trigger pass rate | checkpoint used | timeline used | compact used | ref pass rate | intensity pass rate | required-tool pass rate | allowed-first-tool pass rate | mode-signal pass rate |")
        lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
        for config, data in configs.items():
            lines.append(
                f"| {config} | {data['cases']} | {data['trigger_pass']} | {data['trigger_pass_rate']:.2%} | {data['tool_usage']['context_checkpoint']} | {data['tool_usage']['context_timeline']} | {data['tool_usage']['context_compact']} | {data.get('ref_pass_rate', 0):.2%} | {data.get('intensity_pass_rate', 0):.2%} | {data.get('required_tool_pass_rate', 0):.2%} | {data.get('allowed_first_tool_pass_rate', 0):.2%} | {data.get('mode_signal_pass_rate', 0):.2%} |"
            )
        lines.append("")

    lines.append("## Interesting Cases")
    lines.append("")
    for r in results:
        if (not r.trigger_correct) or (r.required_refs_correct is False) or (r.intensity_expected and not r.intensity_correct) or (r.required_tools_correct is False) or (r.first_tool_allowed is False):
            lines.append(f"### {r.eval_set}/{r.config}/case-{r.case_id}")
            lines.append(f"- should_trigger: {r.should_trigger}")
            lines.append(f"- used_context_tools: {r.used_context_tools}")
            lines.append(f"- first_context_tool: {r.first_context_tool}")
            if r.expected_refs:
                lines.append(f"- expected_refs: {r.expected_refs}")
                lines.append(f"- read_reference_files: {r.read_reference_files}")
                lines.append(f"- required_refs_correct: {r.required_refs_correct}")
            if r.intensity_expected:
                lines.append(f"- expected_intensity: {r.intensity_expected}")
                lines.append(f"- intensity_correct: {r.intensity_correct}")
            if r.must_include_tools or r.must_not_include_tools:
                lines.append(f"- must_include_tools: {r.must_include_tools}")
                lines.append(f"- must_not_include_tools: {r.must_not_include_tools}")
                lines.append(f"- required_tools_correct: {r.required_tools_correct}")
            if r.allowed_first_tools:
                lines.append(f"- allowed_first_tools: {r.allowed_first_tools}")
                lines.append(f"- first_tool_allowed: {r.first_tool_allowed}")
            if r.expected_mode_signal:
                lines.append(f"- expected_mode_signal: {r.expected_mode_signal}")
                lines.append(f"- mode_signal_correct: {r.mode_signal_correct}")
            lines.append(f"- query: {r.query}")
            if r.final_text:
                preview = r.final_text.replace("\n", " ")
                if len(preview) > 240:
                    preview = preview[:240] + "..."
                lines.append(f"- final_text: {preview}")
            if r.error_message:
                lines.append(f"- error: {r.error_message}")
            lines.append("")

    (out_root / "summary.md").write_text("\n".join(lines))


def main() -> int:
    trigger_cases = load_json(TRIGGER_FILE)
    borderline_cases = load_json(BORDERLINE_FILE)
    ref_cases = load_json(REF_FILE) if REF_FILE.exists() else []
    natural_cases = load_json(NATURAL_FILE) if NATURAL_FILE.exists() else []
    natural_actionable_cases = load_json(NATURAL_ACTIONABLE_FILE) if NATURAL_ACTIONABLE_FILE.exists() else []
    natural_recognition_cases = load_json(NATURAL_RECOGNITION_FILE) if NATURAL_RECOGNITION_FILE.exists() else []
    args = sys.argv[1:]
    mode = args[0] if args else "all"
    if mode not in {"all", "trigger", "borderline", "ref", "natural", "natural-actionable", "natural-recognition"}:
        raise SystemExit("usage: run_context_eval.py [all|trigger|borderline|ref|natural|natural-actionable|natural-recognition]")

    run_stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = "" if mode == "all" else f"-{mode}"
    out_root = EVALS_DIR / f"run-{run_stamp}{suffix}"
    out_root.mkdir(parents=True, exist_ok=True)

    with patched_settings_without_installed_pi_context():
        results = []
        if mode in {"all", "trigger"}:
            results.extend(run_eval_set("trigger", trigger_cases, out_root))
        if mode in {"all", "borderline"}:
            results.extend(run_eval_set("borderline", borderline_cases, out_root))
        if mode in {"all", "ref"}:
            results.extend(run_eval_set("ref", ref_cases, out_root))
        if mode in {"all", "natural"}:
            results.extend(run_eval_set("natural", natural_cases, out_root))
        if mode in {"all", "natural-actionable"}:
            results.extend(run_eval_set("natural-actionable", natural_actionable_cases, out_root))
        if mode in {"all", "natural-recognition"}:
            results.extend(run_eval_set("natural-recognition", natural_recognition_cases, out_root))
        summary = summarize(results)
        (out_root / "results.json").write_text(json.dumps([asdict(r) for r in results], ensure_ascii=False, indent=2))
        (out_root / "aggregates.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        write_markdown(results, summary, out_root)
        print(out_root)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
