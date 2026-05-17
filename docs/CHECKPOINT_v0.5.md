# PageSynth v0.5 Checkpoint

## 1. 本版目標

- 在 v0.4 warm 基準風格之外，新增第二個可用模板 pianoPop。
- pianoPop 目標是高密度鋼琴琶音 / pop ballad / soft piano accompaniment。
- 不使用 nylon guitar 作主音色，不使用 blip 主旋律。

## 2. 新增功能

- 新增 style("pianoPop")
- popup parser style 白名單加入 pianoPop
- offscreen STYLE_PRESETS 新增 pianoPop
- pianoPop 加入 playPadArpeggio routing
- pianoPop 使用 handwritten 4-bar piano arp，不使用 generated phrase
- pianoPop blip 靜音
- pianoPop 使用 Casio-Piano-C4.wav 優先

## 3. pianoPop 伴奏設計

- Bar 0：基本型 8-note arpeggio
- Bar 1：變化型 7-note arpeggio
- Bar 2：加法型 9-note arpeggio，含 offset 9 裝飾音
- Bar 3：收束型 6-note arpeggio
- 以 root / fifth / third / octaveRoot 為核心
- third 與 octaveRoot 做音量控制，避免尖銳或怪味

## 4. pianoPop sample 策略

- 首選 casioPianoC4
- fallback softPiano
- guitar samples 只作後段 fallback
- 不使用 guitarPluck 作主音色
- 不使用 musicBox
- sample 不可用時 fallback 到 synth arp，但仍是逐顆 arpeggio，不回到長音 pad

## 5. pianoPop mix 策略

- bass 比 warm 稍多，但不搶
- drums 很輕
- kick / hat / openHat 保守
- snare / clap 幾乎沒有
- blip 靜音
- 不使用長音 pad 作主體

## 6. 測試結果

### 測試 Live Code

```
style("pianoPop")
bpm(96)
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

- 已聽到逐顆鋼琴琶音
- Casio piano 音色可接受，而且很好
- 琶音密度比 warm 更多
- bass 不搶
- drums 很輕
- 沒有長音 pad 糊住

## 7. 目前可用基準模板

- **warm**：nylon guitar / light accompaniment / 基準成功風格
- **pianoPop**：high-density piano arpeggio / pop ballad / 第二個成功模板

## 8. 目前限制

- bright 仍未完成，暫不作為基準
- folk 暫緩
- C 類 motif MIDI 尚未接入
- generated phrase 對 pianoPop 暫不使用，避免事件不穩
- Play This Page 的 Auto Compose 尚未調整到自動選 pianoPop

## 9. 下一步建議

- 不要再大改 warm / pianoPop
- 下一步可調整 Auto Compose，讓頁面 mood 適時選 warm 或 pianoPop
- 或修 bright，但以安全為主
- C 類 motif 暫緩，避免破壞目前乾淨伴奏
