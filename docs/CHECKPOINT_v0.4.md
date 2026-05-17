# PageSynth v0.4 Checkpoint

## 1. 本版目標

- 在 v0.3 的 MIDI phrase / nylon guitar padArp 基礎上，接入 B 類 generated groove。
- 修正 warm style 的 mix，使其成為目前 PageSynth 的基準風格。
- 目標聲音方向：simple song / light accompaniment / nylon guitar arpeggio background。

## 2. 本版重要成果

- B 類 drum groove MIDI 已轉換為 generatedGrooveLibrary.js。
- generatedGrooveLibrary.js 已 safe 接入 offscreen。
- offscreen.html 載入順序已包含：
  - generatedPhraseLibrary.js
  - generatedGrooveLibrary.js
  - offscreen.js
- generated groove 使用 safe whitelist，只接入少量 groove。
- generated groove 同一次播放會 lock，不會每小節重選。
- warm style 的 kick / hat / openHat 已下修。
- warm style 的 snare / clap backbeat 已壓到 ghost level。
- simple / warm / calm 的 blip 已在播放端靜音。
- warm style 測試結果已可作為目前基準風格。

## 3. 目前 warm 基準狀態

- nylon guitar 分解和弦是主體。
- bass 只作輕微支撐。
- drums / groove 在背景。
- 第 2 / 第 4 拍 backbeat 已明顯退後。
- blip 靜音後，背景雜亂與不和諧感消失。
- 整體已可作為 PageSynth 目前的基準風格。

## 4. 新增工具與資料

- tools/convert_midi_grooves.py
- tools/convert_midi_grooves_report.md
- src/generatedGrooveLibrary.js
- 既有：
  - tools/convert_midi_phrases.py
  - tools/inspect_generated_phrase_library.py
  - src/generatedPhraseLibrary.js

## 5. Groove safe 接入策略

- 只接入 safe groove whitelist。
- 不一次啟用全部 24 個 B 類 groove。
- simple / warm / calm 的 generated groove drums 做保守化。
- bright / house groove 目前仍需調整，不作為基準。
- generated groove 只控制 drums，不改 padArp / phrase / bass。

## 6. Soft style blip mute 策略

- simple / warm / calm 的 blip 在 scheduleStep 播放端靜音。
- blip 資料仍保留，不刪除功能。
- bright / tech / industrial 仍可播放 blip。
- 這是目前讓 warm 乾淨、自然的重要修正。

## 7. 目前限制

- warm 已可作基準，但 simple / bright 仍需後續調整。
- bright 目前仍不如 warm，自然度不足。
- B 類 groove 只接入少量 safe groove。
- C 類 motif MIDI 尚未接入。
- guitar sample 仍是少量 one-shot / multisample，不是真正完整樂器庫。
- Play This Page 目前仍偏背景伴奏，不是完整歌曲生成器。

## 8. 下一步建議

- 不要再大改 warm。
- 以 warm 為基準，讓 simple 往 warm 靠近。
- bright 先修到「和聲安全、鼓不搶」即可，不追求華麗。
- 下一步可逐步擴大 safe groove whitelist。
- 之後再考慮 C 類 motif MIDI，但要非常保守，避免 blip 再污染 soft styles。
- 若要改善音色，優先準備更完整 nylon/acoustic guitar multisample。

## 9. 驗收摘要

### warm 測試 code

```
style("warm")
bpm(92)
key("A minor")
scale("minorPentatonic")
chords("Am F C G")
kick("----------------")
hat("----------------")
bass("auto")
blip("auto")
pad("auto")
```

### 驗收結果

- nylon guitar 分解和弦仍是主體。
- 第 2 / 第 4 拍大打擊聲已退後。
- blip 靜音後更乾淨。
- bass 位置正確。
- 整體可作為 PageSynth 目前基準風格。
