#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIB_PATH = ROOT / "src" / "generatedPhraseLibrary.js"
REPORT_PATH = ROOT / "tools" / "inspect_generated_phrase_library_report.md"

ROLE_SET = {"root", "third", "fifth", "octaveRoot"}


def load_library() -> list[dict]:
    text = LIB_PATH.read_text(encoding="utf-8")
    m = re.search(r"export const GENERATED_PHRASE_LIBRARY\s*=\s*(\[.*\]);\s*$", text, re.S)
    if not m:
        raise ValueError("Cannot find GENERATED_PHRASE_LIBRARY JSON block")
    return json.loads(m.group(1))


def main() -> int:
    phrases = load_library()
    total = len(phrases)

    style_counter = Counter()
    invalids = []
    dense = []
    third_heavy = []
    per_phrase_rows = []
    recommended = []
    exclude = []

    for p in phrases:
        pid = p.get("id", "")
        src = p.get("source", "")
        styles = p.get("styles", [])
        events = p.get("events", [])

        for s in styles:
            style_counter[s] += 1

        errs = []
        for k in ["id", "source", "styles", "type", "bars", "events"]:
            if k not in p:
                errs.append(f"missing:{k}")
        if p.get("type") != "arp":
            errs.append("type!=arp")
        if p.get("bars") != 4:
            errs.append("bars!=4")

        role_counter = Counter()
        step_counter = Counter()
        out_of_range = 0
        for e in events:
            bar = e.get("bar")
            step = e.get("step")
            role = e.get("role")
            vel = e.get("velocity")
            dur = e.get("durationSteps")
            if not (isinstance(bar, int) and 0 <= bar <= 3):
                out_of_range += 1
            if not (isinstance(step, int) and 0 <= step <= 15):
                out_of_range += 1
            if role not in ROLE_SET:
                out_of_range += 1
            if not (isinstance(vel, (int, float)) and 0.25 <= float(vel) <= 0.95):
                out_of_range += 1
            if not (isinstance(dur, int) and 1 <= dur <= 4):
                out_of_range += 1
            role_counter[role] += 1
            if isinstance(step, int):
                step_counter[step] += 1

        if out_of_range > 0:
            errs.append(f"invalid_event_fields:{out_of_range}")
        if errs:
            invalids.append((pid, errs))

        evt_count = len(events)
        third_ratio = (role_counter["third"] / evt_count) if evt_count else 0
        if evt_count >= 34:
            dense.append((pid, evt_count))
        if third_ratio >= 0.28:
            third_heavy.append((pid, round(third_ratio, 3), evt_count))

        active_steps = sorted(step_counter.keys())
        step_summary = f"count={len(active_steps)} min={active_steps[0] if active_steps else '-'} max={active_steps[-1] if active_steps else '-'}"

        per_phrase_rows.append({
            "id": pid,
            "styles": styles,
            "events": evt_count,
            "roles": dict(role_counter),
            "step_summary": step_summary,
            "third_ratio": third_ratio,
            "source": src,
        })

    # 推薦：中密度 + third 不高 + 含 simple/warm/calm
    candidates = []
    for r in per_phrase_rows:
        sset = set(r["styles"])
        target = bool(sset & {"simple", "warm", "calm"})
        if not target:
            continue
        score = 0
        score += 2 if 16 <= r["events"] <= 30 else 0
        score += 2 if r["third_ratio"] <= 0.2 else 0
        score += 1 if "simple" in sset else 0
        score += 1 if "warm" in sset else 0
        score += 1 if "calm" in sset else 0
        candidates.append((score, r))
    candidates.sort(key=lambda x: (-x[0], x[1]["events"], x[1]["id"]))
    recommended = [x[1] for x in candidates[:5]]

    # 暫排除：太密或 third 過高
    for r in per_phrase_rows:
        if r["events"] >= 34 or r["third_ratio"] >= 0.28:
            exclude.append(r)

    lines = []
    lines.append("# Inspect Generated Phrase Library Report")
    lines.append("")
    lines.append(f"1. phrase 總數: **{total}**")
    lines.append("")
    lines.append("2. 各 styles 分布")
    for k, v in sorted(style_counter.items()):
        lines.append(f"- {k}: {v}")
    lines.append("")

    lines.append("3. 每個 phrase event 數量")
    for r in per_phrase_rows:
        lines.append(f"- `{r['id']}`: {r['events']}")
    lines.append("")

    lines.append("4. 每個 phrase role 分布")
    for r in per_phrase_rows:
        lines.append(f"- `{r['id']}`: {r['roles']}")
    lines.append("")

    lines.append("5. 每個 phrase step 分布摘要")
    for r in per_phrase_rows:
        lines.append(f"- `{r['id']}`: {r['step_summary']}")
    lines.append("")

    lines.append("6. 推薦優先接入的 5 個 phrase")
    if recommended:
        for r in recommended:
            lines.append(f"- `{r['id']}` (events={r['events']}, third_ratio={r['third_ratio']:.3f}, styles={r['styles']})")
    else:
        lines.append("- 無")
    lines.append("")

    lines.append("7. 建議暫時排除的 phrase")
    if exclude:
        for r in exclude:
            reasons = []
            if r["events"] >= 34:
                reasons.append(f"too_dense(events={r['events']})")
            if r["third_ratio"] >= 0.28:
                reasons.append(f"third_heavy({r['third_ratio']:.3f})")
            lines.append(f"- `{r['id']}`: {', '.join(reasons)}")
    else:
        lines.append("- 無")
    lines.append("")

    lines.append("## 結構/值域檢查")
    lines.append(f"- invalid phrase count: {len(invalids)}")
    if invalids:
        for pid, errs in invalids:
            lines.append(f"  - `{pid}`: {errs}")
    else:
        lines.append("- 全數通過（欄位、type=arp、bars=4、events 值域）")
    lines.append("")

    lines.append("## 額外觀察")
    lines.append(f"- 太密 phrase（events >= 34）: {len(dense)}")
    lines.append(f"- third 比例偏高（>= 0.28）: {len(third_heavy)}")

    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"phrases={total}")
    print(f"invalid={len(invalids)}")
    print(f"report={REPORT_PATH.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
