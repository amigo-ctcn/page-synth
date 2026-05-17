# PageSynth v1.0 Checkpoint

## 1. 本版目標

- 將 PageSynth 從純 Auto Compose 實驗推進成可操作工具。
- 新增 Preset Selector。
- 使用者可直接選擇穩定模板，而不只依賴 Play This Page 自動判斷。

## 2. 新增 Preset Selector

- 在 popup Live Code 區域新增 Preset 下拉選單。
- 與 Mode 並列。
- 使用現有 .mode-select 樣式，不新增複雜 UI。

## 3. Preset 清單

- Auto
- Warm Clean
- PianoPop Flow
- Story Piano
- Study Warm
- Food Life Warm
- Minimal Warm

## 4. Preset 行為

- Auto：沿用 v0.8 mood / topic / chord progression 自動判斷。
- 非 Auto：直接依 preset 定義產生 Live Code。
- Generate From Page 支援 preset。
- Play This Page 支援 preset。
- 手動 Live Code / Run Code 不受 preset 限制。

## 5. 各 Preset 定位

- **Warm Clean**：
  - warm
  - nylon guitar light accompaniment
  - kick / hat 全空
- **PianoPop Flow**：
  - pianoPop
  - piano arp + Bass V2 + light HH
  - 目前主力 preset
- **Story Piano**：
  - pianoPop
  - bpm 較慢
  - 和弦偏情緒與敘事
- **Study Warm**：
  - warm
  - 適合教學 / 文件 / 學習頁
- **Food Life Warm**：
  - warm
  - 適合生活 / 食物 / 健康頁
- **Minimal Warm**：
  - warm
  - 最少干擾、純背景
- **Auto**：
  - 依頁面內容自動選 warm / pianoPop 與 chord progression

## 6. Preset deterministic variation

- preset 仍使用 page seed / variationSeed。
- chord candidates 會 deterministic 選擇。
- BPM 在 preset 範圍內小幅變化。
- 不使用 Math.random。
- 同頁可透過 variationSeed 產生有限變化。

## 7. Storage

- 使用 chrome.storage.local 記住最後 preset。
- 下次開啟 popup 會自動恢復。
- 測試結果：Preset 下次開啟有記住。

## 8. 驗收結果

- Warm Clean：OK
- PianoPop Flow：OK
- Story Piano：OK
- Minimal Warm：OK
- Auto：正常
- Preset 記憶：正常
- 使用者目前最想保留的主力：PianoPop Flow

## 9. 未修改項目

- 未改 offscreen 音訊引擎。
- 未改 warm / pianoPop 音色。
- 未改 Bass V2。
- 未改 HH pattern。
- 未改 Arrangement Engine。
- 未改 manifest。
- 未新增 npm 套件。

## 10. 下一步建議

- 以 PianoPop Flow 為主力繼續擴充。
- 可新增 PianoPop Flow 變奏包：
  - PianoPop Flow A
  - PianoPop Flow B
  - PianoPop Story
  - PianoPop Study
- 可加入更好的 preset 說明文字。
- 可考慮 preset selector 旁增加 short description。
- bright / tech / industrial 暫緩。
- C 類 motif 暫緩。
