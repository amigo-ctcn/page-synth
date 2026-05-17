# PageSynth v0.6.1 Checkpoint

## 1. 本版目標

- Auto Compose 只用 warm / pianoPop，並拉開兩者差異。
- 讓 Play This Page 更穩定、差異更明顯。

## 2. 修改檔案

- `src/popup.js`（Auto Compose preset 更新）
- 未改 `src/offscreen.js`、manifest、UI、lifecycle、parser。

## 3. warm Auto Compose

- `style("warm")`
- `kick("----------------")`（全空，不產生鼓）
- `hat("----------------")`（全空）
- BPM 88~94
- nylon guitar clean accompaniment
- bass 輕支撐
- blip 靜音

## 4. pianoPop Auto Compose

- `style("pianoPop")`
- `kick("----------------")`（全空）
- `hat("x---x---x---x---")`（輕四拍，觸發 offscreen pianoPop builtin HH pattern `xx-x-x-xxx-x-x-x`）
- BPM 94~100
- Casio piano arpeggio 主體
- Bass v2 synth oscillator
- Hi-hat light pattern

## 5. Style 選擇比例

- **general**：70% warm / 30% pianoPop
- **longform**：40% warm / 60% pianoPop
- **story**：50% warm / 50% pianoPop

Auto Compose 不自動產生 bright / tech / industrial / ambient / folk。手動 Live Code 仍可使用所有 style。

## 6. 驗收結果

- warm OK：nylon guitar 主體、乾淨、穩定。
- pianoPop OK：piano arp 主體、bass 音準正確、HH 有流動感。
- 兩者差異比 v0.6 明顯：warm 無鼓無 hat、pianoPop 有 light HH。
- Play This Page 穩定。
- `hat("----------------")` 仍可完全靜音 pianoPop HH。

## 7. 未修改

- offscreen.js（音訊引擎）
- manifest
- UI 結構
- Start/Stop/lifecycle
- parser（style 白名單）

## 8. 下一步建議

- 暫時不要大改 warm / pianoPop。
- 之後可做 preset selector 或更多 page mood mapping。
- bright / motif MIDI 暫緩，避免破壞目前穩定乾淨的伴奏。
