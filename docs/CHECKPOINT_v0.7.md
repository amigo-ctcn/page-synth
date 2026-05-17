# PageSynth v0.7 Checkpoint

## 1. 本版目標

- 在 v0.6.1 的 warm / pianoPop 穩定模板基礎上，加入 Arrangement Engine。
- 讓 PageSynth 不再只是單純 loop，而是具備 intro / main / variation / break / return 段落感。
- 修正 warm 的音色厚度與 Bass V2 音準。

## 2. Arrangement Engine

- 新增 32-bar form：
  - bar 0-3 → intro
  - bar 4-11 → main
  - bar 12-19 → variation
  - bar 20-23 → break
  - bar 24-31 → return
- 32 小節後循環。
- 各 section 的 gating：
  - intro / break：bass 靜音、drums 靜音
  - main / variation / return：bass 正常、drums 輕
  - pianoPop 的 HH 只在 main / variation / return 播放
- pianoPop 測試結果：intro / main / break / return 都可辨識。
- warm 段落較細，但可接受。

## 3. warm v0.7 狀態

- nylon guitar 分解和弦仍是主體。
- padArp 經過暖化：
  - lowpass 從 1700-2800Hz 降至 1500-2400Hz，Q 從 0.55 降至 0.48
  - attack 從 0.012s 放慢至 0.024s
  - release 更自然（dur×0.88，range 0.42-0.72）
  - reverb send 稍增加（0.08 + rev×0.11，約 0.111）
- 新增 very subtle warm body layer：
  - root + fifth
  - sine oscillator
  - 非常低音量（padArp 的 12%）
  - 慢 attack（0.22s）
  - lowpass 900-1400Hz
  - 不使用 third
- 測試結果：
  - warm 更溫潤
  - 沒有變糊
  - nylon guitar 仍清楚
  - body layer 過關

## 4. warm Bass V2 修正

- warm 改用 synth oscillator Bass V2，避免 sample bass 音準問題。
- 修正 F3（MIDI 53）被 clamp 成 E3（MIDI 52）的問題：clamp 範圍從 45-52 放寬至 45-59。
- warm Bass V2 mapping：
  - Am → A2（MIDI 45）
  - F → F3（MIDI 53）
  - C → C3（MIDI 48）
  - G → B2（MIDI 47）
- warm rhythm 仍是 [0, 8]。
- 測試結果：
  - F bass 準
  - G/B bass 自然
  - bass 不搶

## 5. pianoPop v0.7 狀態

- Casio piano arpeggio 仍是主體。
- Bass V2 使用 synth oscillator，音準正確。
- Bass rhythm 為 [0, 4, 12]，即 x x - x。
- pianoPop bass mapping：
  - Am → A2（MIDI 45）
  - F → F3（MIDI 53）
  - C → C3（MIDI 48）
  - G → B2（MIDI 47）
- HH pattern：
  - xx-x-x-xxx-x-x-x
  - steps [0, 1, 3, 5, 7, 8, 9, 11, 13, 15]
  - closed hi-hat only
  - step 0 / 8 velocity 0.24，其餘 0.18
- 測試結果：
  - piano arp 是主體
  - bass 音準正確
  - HH 有流動感但不刺耳
  - 沒有 kick / snare / clap 轟鳴

## 6. Auto Compose 狀態

- Play This Page 只自動選 warm / pianoPop。
- warm 產生：
  - kick("----------------")
  - hat("----------------")
  - BPM 88-94
- pianoPop 產生：
  - kick("----------------")
  - hat("x---x---x---x---")
  - BPM 94-100
- 手動 bright / tech / industrial 仍可用，但不作為自動預設。

## 7. 目前穩定模板

- **warm**：
  - 溫潤 nylon guitar light accompaniment
  - 最安全基準模板
- **pianoPop**：
  - Casio piano arp + Bass V2 + light HH
  - 第二個穩定模板
- **Arrangement Engine**：
  - 為兩者提供段落起伏（intro / main / variation / break / return）

## 8. 目前限制

- bright 仍未完成，不作為基準。
- folk 暫緩。
- C 類 motif MIDI 尚未接入。
- generated phrase / generated groove 目前只作為 warm / pianoPop 穩定模板的支撐，不再盲目擴大。
- Bass V2 目前主要為 warm / pianoPop 調整，其他 style 不一定適用。

## 9. 下一步建議

- 暫時不要大改 warm / pianoPop。
- 可以考慮：
  - 做更多 pianoPop / warm 的 chord progression preset
  - 加入 song ending / fade-out
  - 增加 preset selector
  - 改善 Play This Page 的頁面情緒分類
- bright / C 類 motif 暫緩，避免破壞目前乾淨伴奏。
