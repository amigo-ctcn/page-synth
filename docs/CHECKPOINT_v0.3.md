# PageSynth CHECKPOINT v0.3

## 1. 本版目標

- 從偏電子感的 data sonification，進一步轉向 **simple song / accompaniment**。
- 以 **nylon guitar 分解和弦** 作為 simple / warm / calm 的主體聲音。

## 2. 本版重要成果

- MIDI A 類 arpeggio 轉換完成。
- `generatedPhraseLibrary.js` 產生完成。
- safe 5 個 generated phrase 接入。
- generated phrase lock 機制完成。
- `bar0 → bar1 → bar2 → bar3` 可連續播放。
- simple / warm / calm 的 padArp 已使用 generated phrase。
- padArp 支援 multi-sample selection。
- bass 已退到背景，不再壓過分解和弦。

## 3. 新增工具

- `tools/convert_midi_phrases.py`
- `tools/inspect_generated_phrase_library.py`
- `tools/convert_midi_phrases_report.md`
- `tools/inspect_generated_phrase_library_report.md`

## 4. 新增或使用的 sample

- `nylon_guitar_C3.wav`
- `nylon_guitar_C4.wav`
- `acoustic_guitar_C3.wav`
- `soft_piano_C4.wav`
- `guitar_pluck_C4.wav`
- `Casio-Piano-C4.wav`
- `Kawai-Bass1-C2.wav`
- `Alesis-Music-Box-C6.wav`

## 5. 目前 sample 使用策略

- simple / warm / calm 的 padArp 優先使用 nylon guitar / guitar 類 sample。
- Casio Piano 只作為 fallback。
- Music Box 暫不參與主伴奏。
- Kawai Bass 保守接入，且 bass 已大幅降音量。

## 6. 目前聲音狀態

- simple / warm 的分解和弦已成為主體。
- bass 位置已正確，只做支撐。
- third 的怪味已降低。
- generated MIDI phrase 相較固定手寫 loop 更連貫。
- 音色仍非完全真實，但比早期 synth / blip / pad 明顯自然。

## 7. 目前限制

- 目前只接入 A 類 MIDI phrase，尚未接 B 類 groove / C 類 motif。
- safe phrase 目前只開 5 個。
- 吉他 sample 仍是少量 one-shot，非完整 multisample library。
- Play This Page 仍偏背景伴奏，不是完整歌曲。
- melody / blip 仍不是成熟主旋律。

## 8. 下一步建議

- 暫時不要大改引擎。
- 先擴充 safe phrase list 到 8~10 個。
- 之後轉換 B 類 drum groove MIDI，改善節奏自然度。
- 再考慮 C 類 motif MIDI，改善旋律。
- 若要更自然音色，準備更完整的 guitar / piano multisample。
