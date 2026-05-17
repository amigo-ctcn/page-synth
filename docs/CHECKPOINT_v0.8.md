# PageSynth v0.8 Checkpoint

## 1. 本版目標

- 在 v0.7 的 Arrangement Engine 基礎上，加入 Chord Progression Library。
- 讓 Auto Compose 根據頁面 mood / topic 選擇不同和弦進行。
- 穩定 warm / pianoPop 兩個模板。
- 完成 pianoPop HH pattern 與 Bass V2 的可用版本。

## 2. Chord Progression Library

- 新增 CHORD_PROGRESSIONS。
- warm 分類：
  - gentle
  - folk
  - hopeful
  - reflective
  - learning
  - foodLife
- pianoPop 分類：
  - ballad
  - emotional
  - longform
  - hopeful
  - calmFlow
- 僅使用安全 chord：
  - C, D, E, F, G, A, B
  - Am, Em, Dm
- 不使用 flat chord、slash chord、maj7、sus、add9 等 parser 風險較高的 chord。

## 3. Page Mood → Chord Progression

- classifyPageMood 回傳 mood/topic/wordCount。
- topic 可判斷：
  - learning
  - foodLife
  - emotional
  - calm
  - general
- mood 可判斷：
  - longform
  - story
  - calm
  - general
- warm / pianoPop 根據 mood/topic 選不同 progression。
- 測試結果：
  - 一般頁面 OK
  - 長文頁面 OK
  - 教學頁面 OK
  - 比固定 Am F C G 更有變化

## 4. Auto Compose v0.8 狀態

- Auto Compose 仍只自動產生：
  - style("warm")
  - style("pianoPop")
- 不自動產生：
  - bright
  - tech
  - industrial
  - ambient
  - folk
- 手動 Live Code 仍可使用其他 style。
- warm 產生：
  - kick("----------------")
  - hat("----------------")
- pianoPop 產生：
  - kick("----------------")
  - hat("x---x---x---x---")

## 5. warm v0.8 狀態

- warm 是溫潤 nylon guitar light accompaniment。
- nylon guitar padArp 仍是主體。
- warm body layer 已通過測試：
  - root + fifth
  - sine oscillator
  - very subtle
  - 不糊
- warm Bass V2 使用 synth oscillator，音準穩定。
- warm bass mapping：
  - Am → A2
  - F → F3
  - C → C3
  - G → B2
- warm rhythm 仍是 [0, 8]。
- 測試結果：
  - 更溫潤
  - 沒有變糊
  - nylon guitar 清楚
  - F bass 準
  - G/B bass 自然

## 6. pianoPop v0.8 狀態

- pianoPop 是 Casio piano arpeggio + Bass V2 + light closed hi-hat。
- piano arp 是主體。
- Bass V2 使用 synth oscillator，避免 sample bass 音準問題。
- pianoPop bass rhythm：
  - [0, 4, 12]
  - 也就是 x x - x
- pianoPop bass mapping：
  - Am → A2
  - F → F3
  - C → C3
  - G → B2
- 測試結果：
  - bass 音準正確
  - bass 在拍點上
  - bass 不轟、不搶
  - piano arp 仍是主體

## 7. pianoPop HH pattern 定案

- pianoPop builtin closed hi-hat pattern：
  - xx-x-x-xxx-x-x-x
- steps：
  - [0, 1, 3, 5, 7, 8, 9, 11, 13, 15]
- velocity：
  - step 0 / 8：0.36
  - 其他 steps：0.28
- closed hi-hat only。
- 不使用 openHat。
- 不加入 kick / snare / clap。
- hat("----------------") 仍可完全靜音。
- 測試結果：
  - hi-hat 清楚
  - 不刺耳
  - 不搶 piano arp
  - 整體仍像 pianoPop，不像 dance

## 8. Arrangement Engine 狀態

- 32-bar form：
  - bar 0-3 → intro
  - bar 4-11 → main
  - bar 12-19 → variation
  - bar 20-23 → break
  - bar 24-31 → return
- pianoPop 段落感明顯：
  - intro OK
  - main / return OK
  - break OK
- warm 段落較細，但可接受。

## 9. 目前穩定模板

- **warm**：
  - 溫潤 nylon guitar
  - body layer
  - Bass V2
  - 乾淨基準伴奏
- **pianoPop**：
  - Casio piano arp
  - Bass V2
  - light HH
  - 比 warm 更流動
- **Auto Compose**：
  - 根據頁面選 warm / pianoPop
  - 根據 mood/topic 選 chord progression

## 10. 目前限制

- bright 仍未完成，不作為預設。
- folk 暫緩。
- C 類 motif MIDI 尚未接入。
- Bass V2 主要針對 warm / pianoPop 成功，其他 style 未必適用。
- 尚未做 preset selector。
- 尚未做 song ending / fade-out。
- 尚未支援 slash chord，例如 G/B，只是內部 bass mapping 模擬部分效果。

## 11. 下一步建議

- 暫時不要大改 warm / pianoPop。
- 可考慮：
  - Song ending / fade-out
  - Preset selector
  - More page mood mapping
  - Warm / pianoPop 變奏包
  - 更好的 piano / guitar multisample
- bright / C 類 motif 暫緩，避免破壞目前乾淨伴奏。
