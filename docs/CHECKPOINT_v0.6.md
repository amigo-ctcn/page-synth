# PageSynth v0.6 Checkpoint

## 1. 本版目標

- 在 v0.4 / v0.5 基礎上，穩定 Auto Compose 與 pianoPop。
- 讓 Play This Page 優先使用目前穩定模板 warm / pianoPop。
- 修正 pianoPop 的 bass、hi-hat、琶音平衡，使其成為第二個穩定模板。

## 2. Auto Compose v0.6

- src/popup.js 已調整 Auto Compose。
- Play This Page 現在只會自動產生 style("warm") 或 style("pianoPop")。
- bright / tech / industrial 不再作為一般自動預設。
- 手動 Live Code 仍可使用 bright / tech / industrial。
- 一般頁面偏 warm。
- 長文 / 敘事 / 教學 / 生活類頁面有機會使用 pianoPop。

## 3. warm 目前狀態

- warm 是目前基準成功風格。
- nylon guitar 分解和弦是主體。
- bass 輕支撐。
- drums 很輕。
- backbeat 已壓低。
- blip 在 soft styles 播放端靜音。
- 整體乾淨、穩定、適合作為 PageSynth 基準。

## 4. pianoPop 目前狀態

- pianoPop 是第二個成功模板。
- 使用 Casio piano 作為主要 arpeggio 音色。
- 使用 handwritten 4-bar piano arp，不使用 generated phrase。
- piano arp 是主體。
- bass 使用 Bass v2 synth oscillator，確保音準。
- hi-hat 使用 light HH pattern。
- blip 靜音。
- 不使用長音 pad 作主體。

## 5. pianoPop bass 修正

- pianoPop 停用 sample bass，改用 synth oscillator Bass v2。
- 修正 F3 被 clamp 成 E3 的問題。
- pianoPop bass rhythm 改為 [0, 4, 12]，也就是 x x - x。
- pianoPop bass 目前對 Am/F/C/G 使用：
  - Am → A2
  - F → F3
  - C → C3
  - G → B2
- bass 音準正確，音量可用，不搶 piano arp。

## 6. pianoPop hi-hat 修正

- pianoPop 內建 HH pattern 改為：
  xx-x-x-xxx-x-x-x
- steps:
  [0, 1, 3, 5, 7, 8, 9, 11, 13, 15]
- step 0 / 8 velocity 0.24
- 其他 steps velocity 0.18
- 全部 closed hi-hat，不使用 openHat。
- 不加入 kick / snare / clap。
- hat("----------------") 仍可完全靜音。

## 7. 目前穩定模板

- warm：
  - nylon guitar light accompaniment
  - 最安全基準模板
- pianoPop：
  - piano arpeggio + root bass + light HH
  - 比 warm 更流動、更有節奏

## 8. 目前限制

- bright 仍未完成，不作為預設。
- tech / industrial 仍保留手動測試，但不作為自動預設。
- folk 暫緩。
- C 類 motif MIDI 尚未接入。
- Bass v2 目前主要針對 pianoPop 成功，其他 style 不一定適用。
- Auto Compose 的 warm / pianoPop 區分仍可再優化，因使用者曾覺得兩者在自動生成時差異不夠明顯，但手動修正後 pianoPop 已明顯改善。

## 9. 驗收測試

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

驗收：
- nylon guitar 是主體。
- 聲音乾淨。
- blip 無雜音。
- warm 可作為基準風格。

### pianoPop 測試 code

```
style("pianoPop")
bpm(96)
key("A minor")
scale("minorPentatonic")
chords("Am F C G")
kick("----------------")
hat("x---x---x---x---")
bass("auto")
blip("auto")
pad("auto")
```

驗收：
- piano arp 是主體。
- bass 音準與音量 OK。
- hi-hat 有流動感但不刺耳。
- 沒有 kick / snare / clap 轟鳴。
- hat("----------------") 仍可完全靜音。

## 10. 下一步建議

- 暫時不要大改 warm / pianoPop。
- 可以優先整理 Auto Compose，讓一般頁面更穩定選 warm，較長文章或情緒內容選 pianoPop。
- bright 之後再處理，但不要影響 warm / pianoPop。
- C 類 motif MIDI 暫緩，避免重新帶入 blip 雜音。
- 若要改善音色，優先找更好的 piano multisample 或 acoustic bass，但不要破壞目前穩定平衡。
