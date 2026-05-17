#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


ROOT = Path(__file__).resolve().parents[1]
MIDI_B_ROOT = ROOT / "assets" / "samples" / "midi" / "B"
OUT_JS = ROOT / "src" / "generatedGrooveLibrary.js"
OUT_REPORT = ROOT / "tools" / "convert_midi_grooves_report.md"


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


def parse_midi_file(path: Path) -> Tuple[int, int, List[MidiNote], List[str]]:
    data = path.read_bytes()
    i = 0
    warnings: List[str] = []
    source_bpm = 120

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

    if fmt != 1:
        warnings.append(f"Format is {fmt}, expected format 1; continue best-effort")
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
                meta_type = trk[j]
                j += 1
                l, j = read_vlq(trk, j)
                payload = trk[j:j + l]
                j += l
                if meta_type == 0x51 and l == 3:
                    us_per_qn = int.from_bytes(payload, "big")
                    if us_per_qn > 0:
                        source_bpm = round(60000000 / us_per_qn)
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
    return ppq, source_bpm, all_notes, warnings


def infer_styles(path_str: str) -> List[str]:
    p = path_str.lower()
    if "simple_folk_groove" in p:
        return ["simple", "warm"]
    if "folk_groove" in p:
        return ["simple", "warm"]
    if "soft_pop_groove" in p:
        return ["simple", "warm", "bright"]
    if "light_rock_pop_groove" in p:
        return ["bright", "warm"]
    if "reggae_offbeat_groove" in p:
        return ["simple", "warm", "bright"]
    if "house_offbeat_hat_groove" in p:
        return ["bright", "tech"]
    if "syncopated_pop_groove" in p:
        return ["warm", "bright", "simple"]
    return ["simple"]


def make_id(path: Path) -> str:
    stem = path.stem.lower()
    s = re.sub(r"[^a-z0-9]+", "_", stem)
    s = re.sub(r"_+", "_", s).strip("_")
    return f"b_{s}"


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def tick_to_bar_step(tick: int, ppq: int) -> Tuple[int, int]:
    bar_ticks = ppq * 4
    step_ticks = ppq / 4
    bar = tick // bar_ticks
    step = int(round((tick % bar_ticks) / step_ticks))
    return int(bar), int(max(0, min(15, step)))


def map_drum_part(pitch: int) -> Optional[str]:
    if pitch in (35, 36):
        return "kick"
    if pitch in (38, 40):
        return "snare"
    if pitch == 39:
        return "clap"
    if pitch in (42, 44):
        return "hat"
    if pitch == 46:
        return "openHat"
    return None


def normalize_velocity(part: str, vel: int) -> float:
    v = vel / 127.0
    if part == "kick":
        return round(clamp(v, 0.20, 0.70), 3)
    if part in ("snare", "clap"):
        return round(clamp(v, 0.15, 0.55), 3)
    if part == "hat":
        return round(clamp(v, 0.08, 0.45), 3)
    if part == "openHat":
        return round(clamp(v, 0.10, 0.55), 3)
    return round(clamp(v, 0.0, 1.0), 3)


def to_groove(path: Path) -> Tuple[Optional[dict], List[str], dict]:
    ppq, source_bpm, notes, warnings = parse_midi_file(path)
    if not notes:
        return None, warnings + ["No notes"], {}

    bucket: Dict[str, Dict[Tuple[int, int], float]] = {
        "kick": {}, "snare": {}, "clap": {}, "hat": {}, "openHat": {}
    }
    ignored_pitch_count = 0

    for n in notes:
        bar, step = tick_to_bar_step(n.start_tick, ppq)
        if bar < 0 or bar > 3:
            continue
        part = map_drum_part(n.pitch)
        if part is None:
            ignored_pitch_count += 1
            continue
        vel = normalize_velocity(part, n.velocity)
        key = (bar, step)
        prev = bucket[part].get(key)
        if prev is None or vel > prev:
            bucket[part][key] = vel

    if ignored_pitch_count > 0:
        warnings.append(f"Ignored unsupported drum notes: {ignored_pitch_count}")

    # openHat 與 hat 同 step：openHat 優先
    for key in list(bucket["openHat"].keys()):
        if key in bucket["hat"]:
            del bucket["hat"][key]

    def ev_list(part: str) -> List[dict]:
        return [
            {"bar": b, "step": s, "velocity": round(v, 3)}
            for (b, s), v in sorted(bucket[part].items(), key=lambda x: (x[0][0], x[0][1]))
        ]

    kick = ev_list("kick")
    snare = ev_list("snare")
    clap = ev_list("clap")
    hat = ev_list("hat")
    open_hat = ev_list("openHat")

    # kick 太密檢查
    kick_dense_bars: List[int] = []
    for b in range(4):
        kc = sum(1 for e in kick if e["bar"] == b)
        if kc > 5:
            kick_dense_bars.append(b)
    if kick_dense_bars:
        warnings.append(f"Kick too dense in bars: {kick_dense_bars}")

    if not (kick or snare or clap or hat or open_hat):
        return None, warnings + ["No usable drum events in first 4 bars"], {}

    src = path.relative_to(ROOT).as_posix()
    groove = {
        "id": make_id(path),
        "source": src,
        "styles": infer_styles(src),
        "type": "groove",
        "bars": 4,
        "kick": kick,
        "snare": snare,
        "clap": clap,
        "hat": hat,
        "openHat": open_hat,
        "meta": {
            "sourceBpm": source_bpm,
            "ppq": ppq
        }
    }

    analysis = {
        "kick_count": len(kick),
        "snare_count": len(snare),
        "clap_count": len(clap),
        "hat_count": len(hat),
        "openHat_count": len(open_hat),
        "has_offbeat_openhat": any(e["step"] in (2, 6, 10, 14) for e in open_hat),
        "has_syncopation": any(
            e["step"] not in (0, 4, 8, 12)
            for e in (kick + snare + clap)
        ),
        "kick_dense_bars": kick_dense_bars,
    }
    return groove, warnings, analysis


def write_js(grooves: List[dict]) -> None:
    content = (
        "// Auto-generated by tools/convert_midi_grooves.py\n"
        "// Source: assets/samples/midi/B\n"
        "// Do not edit manually.\n\n"
        f"self.GENERATED_GROOVE_LIBRARY = {json.dumps(grooves, ensure_ascii=False, indent=2)};\n"
    )
    OUT_JS.write_text(content, encoding="utf-8")


def pick_recommendations(grooves: List[dict]) -> List[str]:
    pools = {
        "soft_pop": [g["id"] for g in grooves if "soft_pop" in g["id"]],
        "folk": [g["id"] for g in grooves if "folk" in g["id"]],
        "reggae_offbeat": [g["id"] for g in grooves if "reggae_offbeat" in g["id"]],
        "house_offbeat": [g["id"] for g in grooves if "house_offbeat" in g["id"]],
        "syncopated_pop": [g["id"] for g in grooves if "syncopated_pop" in g["id"]],
        "light_rock_pop": [g["id"] for g in grooves if "light_rock_pop" in g["id"]],
    }
    out: List[str] = []
    for k in ("soft_pop", "folk", "reggae_offbeat", "house_offbeat", "syncopated_pop", "light_rock_pop"):
        if pools[k]:
            out.append(pools[k][0])
    return out


def write_report(
    total: int,
    ok: List[dict],
    failed: List[Tuple[str, str]],
    warns: Dict[str, List[str]],
    analyses: Dict[str, dict],
) -> None:
    lines: List[str] = []
    lines.append("# MIDI Groove Convert Report")
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

    lines.append("## 每個 groove 事件數")
    for g in ok:
        a = analyses.get(g["id"], {})
        lines.append(
            f"- `{g['id']}`: kick={a.get('kick_count',0)}, snare={a.get('snare_count',0)}, "
            f"clap={a.get('clap_count',0)}, hat={a.get('hat_count',0)}, openHat={a.get('openHat_count',0)}"
        )
    lines.append("")

    lines.append("## 有 offbeat openHat 的 grooves (step 2/6/10/14)")
    offbeat = [gid for gid, a in analyses.items() if a.get("has_offbeat_openhat")]
    if offbeat:
        for gid in offbeat:
            lines.append(f"- `{gid}`")
    else:
        lines.append("- 無")
    lines.append("")

    lines.append("## 有 syncopation 的 grooves (kick/snare/clap 非 0/4/8/12)")
    sync = [gid for gid, a in analyses.items() if a.get("has_syncopation")]
    if sync:
        for gid in sync:
            lines.append(f"- `{gid}`")
    else:
        lines.append("- 無")
    lines.append("")

    lines.append("## kick 太多（單 bar > 5）")
    dense_any = False
    for gid, a in analyses.items():
        bars = a.get("kick_dense_bars") or []
        if bars:
            dense_any = True
            lines.append(f"- `{gid}`: bars={bars}")
    if not dense_any:
        lines.append("- 無")
    lines.append("")

    lines.append("## 推薦優先接入的 6 個 groove")
    rec = pick_recommendations(ok)
    if rec:
        for gid in rec:
            lines.append(f"- `{gid}`")
    else:
        lines.append("- 無")
    lines.append("")

    lines.append("## 建議暫時排除的 groove")
    excluded = [gid for gid, a in analyses.items() if (a.get("kick_dense_bars") or [])]
    if excluded:
        for gid in excluded:
            lines.append(f"- `{gid}`")
    else:
        lines.append("- 無")
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
    midi_files = sorted(MIDI_B_ROOT.glob("**/*.mid"))
    total = len(midi_files)

    ok: List[dict] = []
    failed: List[Tuple[str, str]] = []
    warns: Dict[str, List[str]] = {}
    analyses: Dict[str, dict] = {}

    for mf in midi_files:
        rel = mf.relative_to(ROOT).as_posix()
        try:
            groove, ws, analysis = to_groove(mf)
            warns[rel] = ws
            if groove is None:
                failed.append((rel, "No groove generated"))
            else:
                ok.append(groove)
                analyses[groove["id"]] = analysis
        except Exception as e:
            failed.append((rel, str(e)))

    write_js(ok)
    write_report(total, ok, failed, warns, analyses)

    print(f"Scanned: {total}")
    print(f"Converted: {len(ok)}")
    print(f"Failed: {len(failed)}")
    print(f"Output: {OUT_JS.relative_to(ROOT).as_posix()}")
    print(f"Report: {OUT_REPORT.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
