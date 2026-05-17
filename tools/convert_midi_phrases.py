#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


ROOT = Path(__file__).resolve().parents[1]
MIDI_A_ROOT = ROOT / "assets" / "samples" / "midi" / "A"
OUT_JS = ROOT / "src" / "generatedPhraseLibrary.js"
OUT_REPORT = ROOT / "tools" / "convert_midi_phrases_report.md"


@dataclass
class MidiNote:
    start_tick: int
    end_tick: int
    pitch: int
    velocity: int


def read_u32_be(b: bytes, i: int) -> Tuple[int, int]:
    return int.from_bytes(b[i:i + 4], "big"), i + 4


def read_u16_be(b: bytes, i: int) -> Tuple[int, int]:
    return int.from_bytes(b[i:i + 2], "big"), i + 2


def read_vlq(b: bytes, i: int) -> Tuple[int, int]:
    value = 0
    while True:
        if i >= len(b):
            raise ValueError("Unexpected EOF while reading VLQ")
        c = b[i]
        i += 1
        value = (value << 7) | (c & 0x7F)
        if (c & 0x80) == 0:
            break
    return value, i


def parse_midi_file(path: Path) -> Tuple[int, List[MidiNote], List[str]]:
    data = path.read_bytes()
    i = 0
    warnings: List[str] = []

    if data[i:i + 4] != b"MThd":
        raise ValueError("Missing MThd")
    i += 4
    header_len, i = read_u32_be(data, i)
    if header_len < 6:
        raise ValueError("Invalid MThd length")
    fmt, i = read_u16_be(data, i)
    ntrks, i = read_u16_be(data, i)
    division, i = read_u16_be(data, i)
    i = 8 + header_len

    if fmt not in (0, 1):
        warnings.append(f"Unsupported format {fmt}, try best-effort")
    if division & 0x8000:
        raise ValueError("SMPTE division not supported")
    ppq = division

    all_notes: List[MidiNote] = []

    for _ in range(ntrks):
        if i + 8 > len(data) or data[i:i + 4] != b"MTrk":
            raise ValueError("Missing MTrk")
        i += 4
        trk_len, i = read_u32_be(data, i)
        trk = data[i:i + trk_len]
        i += trk_len

        t = 0
        j = 0
        running_status: Optional[int] = None
        active: Dict[Tuple[int, int], List[Tuple[int, int]]] = {}

        while j < len(trk):
            delta, j = read_vlq(trk, j)
            t += delta
            if j >= len(trk):
                break

            status = trk[j]
            if status & 0x80:
                j += 1
                running_status = status
            else:
                if running_status is None:
                    raise ValueError("Running status without previous status")
                status = running_status

            if status == 0xFF:
                if j >= len(trk):
                    break
                _meta_type = trk[j]
                j += 1
                l, j = read_vlq(trk, j)
                j += l
                continue

            if status in (0xF0, 0xF7):
                l, j = read_vlq(trk, j)
                j += l
                continue

            evt = status & 0xF0
            ch = status & 0x0F

            if evt in (0x80, 0x90):
                if j + 1 >= len(trk):
                    break
                note = trk[j]
                vel = trk[j + 1]
                j += 2
                key = (ch, note)
                is_on = evt == 0x90 and vel > 0
                if is_on:
                    active.setdefault(key, []).append((t, vel))
                else:
                    lst = active.get(key)
                    if lst:
                        st, sv = lst.pop(0)
                        if t > st:
                            all_notes.append(MidiNote(st, t, note, sv))
            elif evt in (0xA0, 0xB0, 0xE0):
                j += 2
            elif evt in (0xC0, 0xD0):
                j += 1
            else:
                warnings.append(f"Unknown status 0x{status:02X}")
                break

    all_notes.sort(key=lambda n: (n.start_tick, n.pitch))
    return ppq, all_notes, warnings


def infer_styles(path_str: str) -> List[str]:
    p = path_str.lower()
    if "simple_folk" in p:
        return ["simple", "warm"]
    if "folk" in p:
        return ["simple", "warm"]
    if "nylon" in p:
        return ["simple", "warm"]
    if "soft_pop" in p:
        return ["simple", "bright", "warm"]
    if "piano" in p:
        return ["simple", "calm"]
    if "ballad" in p:
        return ["warm", "calm"]
    if "calm" in p or "ambient" in p:
        return ["calm", "ambient"]
    return ["simple"]


def make_id(path: Path) -> str:
    rel = path.relative_to(ROOT / "assets" / "samples" / "midi")
    stem = str(rel.with_suffix(""))
    s = stem.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


ROLE_INTERVALS = [0, 3, 4, 7, 12]


def nearest_interval(x: int) -> int:
    x_mod = x % 12
    candidates = [0, 3, 4, 7]
    best = min(candidates, key=lambda c: min((x_mod - c) % 12, (c - x_mod) % 12))
    return best


def map_role(pitch: int, root_pitch: int) -> str:
    diff = pitch - root_pitch
    iv = diff % 12
    if iv == 0:
        return "octaveRoot" if diff >= 10 else "root"
    if iv in (3, 4):
        return "third"
    if iv == 7:
        return "fifth"
    n = nearest_interval(iv)
    if n == 0:
        return "octaveRoot" if diff >= 10 else "root"
    if n in (3, 4):
        return "third"
    return "fifth"


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def to_phrase(path: Path) -> Tuple[Optional[dict], List[str]]:
    ppq, notes, warnings = parse_midi_file(path)
    if not notes:
        return None, warnings + ["No notes"]

    bar_ticks = ppq * 4
    step_ticks = ppq / 4

    by_bar: Dict[int, List[MidiNote]] = {0: [], 1: [], 2: [], 3: []}
    for n in notes:
        b = n.start_tick // bar_ticks
        if 0 <= b <= 3:
            by_bar[b].append(n)

    bar_roots: Dict[int, int] = {}
    for b in range(4):
        bn = by_bar[b]
        if bn:
            first = min(bn, key=lambda x: (x.start_tick, x.pitch))
            low = min(bn, key=lambda x: x.pitch)
            root = low.pitch if low.start_tick - first.start_tick <= ppq else first.pitch
            bar_roots[b] = root
        else:
            bar_roots[b] = 48

    events = []
    role_warn = 0
    for n in notes:
        bar = n.start_tick // bar_ticks
        if not (0 <= bar <= 3):
            continue
        bar_start = bar * bar_ticks
        rel = n.start_tick - bar_start
        step = int(round(rel / step_ticks))
        step = clamp(step, 0, 15)

        dur_ticks = max(1, n.end_tick - n.start_tick)
        dur_steps = int(round(dur_ticks / step_ticks))
        dur_steps = clamp(dur_steps, 1, 4)

        role = map_role(n.pitch, bar_roots[bar])
        if role not in ("root", "third", "fifth", "octaveRoot"):
            role_warn += 1
            continue

        vel = round(clamp(n.velocity / 127.0, 0.25, 0.95), 3)
        events.append({
            "bar": int(bar),
            "step": int(step),
            "role": role,
            "velocity": vel,
            "durationSteps": int(dur_steps)
        })

    # 去重（同 bar/step/role 保留較大 velocity）
    merged: Dict[Tuple[int, int, str], dict] = {}
    for e in events:
        k = (e["bar"], e["step"], e["role"])
        if k not in merged or e["velocity"] > merged[k]["velocity"]:
            merged[k] = e
    final_events = sorted(merged.values(), key=lambda e: (e["bar"], e["step"], e["role"]))

    if role_warn:
        warnings.append(f"role fallback count: {role_warn}")

    if not final_events:
        return None, warnings + ["No usable events in first 4 bars"]

    src = path.relative_to(ROOT).as_posix()
    phrase = {
        "id": make_id(path),
        "source": src,
        "styles": infer_styles(src),
        "type": "arp",
        "bars": 4,
        "events": final_events,
    }
    return phrase, warnings


def write_js(phrases: List[dict]) -> None:
    content = (
        "// Auto-generated by tools/convert_midi_phrases.py\n"
        "// Source: assets/samples/midi/A\n"
        "// Do not edit manually.\n\n"
        f"export const GENERATED_PHRASE_LIBRARY = {json.dumps(phrases, ensure_ascii=False, indent=2)};\n"
    )
    OUT_JS.write_text(content, encoding="utf-8")


def write_report(total: int, ok: List[dict], failed: List[Tuple[str, str]], warns: Dict[str, List[str]]) -> None:
    lines: List[str] = []
    lines.append("# MIDI Phrase Convert Report")
    lines.append("")
    lines.append(f"1. 掃描 MIDI 數量: **{total}**")
    lines.append(f"2. 成功轉換數量: **{len(ok)}**")
    lines.append(f"3. 失敗檔案數量: **{len(failed)}**")
    lines.append("")
    lines.append("## 失敗檔案列表")
    if failed:
        for p, err in failed:
            lines.append(f"- `{p}`: {err}")
    else:
        lines.append("- 無")

    lines.append("")
    lines.append("## 每個 phrase 的 event 數量")
    for ph in ok:
        lines.append(f"- `{ph['id']}`: {len(ph['events'])}")

    lines.append("")
    lines.append("## 前 3 個 phrase 範例")
    for ph in ok[:3]:
        lines.append(f"### {ph['id']}")
        lines.append("```json")
        lines.append(json.dumps(ph, ensure_ascii=False, indent=2))
        lines.append("```")

    lines.append("")
    lines.append("## 警告")
    any_warn = False
    for p, ws in warns.items():
        if ws:
            any_warn = True
            lines.append(f"- `{p}`")
            for w in ws:
                lines.append(f"  - {w}")
    if not any_warn:
        lines.append("- 無")

    OUT_REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    midi_files = sorted(MIDI_A_ROOT.glob("**/*.mid"))
    total = len(midi_files)

    ok: List[dict] = []
    failed: List[Tuple[str, str]] = []
    warns: Dict[str, List[str]] = {}

    for mf in midi_files:
        rel = mf.relative_to(ROOT).as_posix()
        try:
            phrase, ws = to_phrase(mf)
            warns[rel] = ws
            if phrase is None:
                failed.append((rel, "No phrase generated"))
            else:
                ok.append(phrase)
        except Exception as e:
            failed.append((rel, str(e)))

    ok = [p for p in ok if p.get("events")]

    write_js(ok)
    write_report(total, ok, failed, warns)

    print(f"Scanned: {total}")
    print(f"Converted: {len(ok)}")
    print(f"Failed: {len(failed)}")
    print(f"Output: {OUT_JS.relative_to(ROOT).as_posix()}")
    print(f"Report: {OUT_REPORT.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
