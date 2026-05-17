# PageSynth v0.9 Checkpoint

## 1. 本版目標

- 改善 Stop Music 行為。
- Stop 時不再硬切聲音，而是 smooth fade-out。
- 修正 Stop 後 UI 按鈕偶爾卡灰問題。
- 保持 Start / Stop / Play This Page 既有流程穩定。

## 2. Smooth Fade-out

- Stop Music 觸發 smoothStopAllAudio。
- fade-out duration：1.2 秒。
- Stop 時先停止 scheduler，不再排程新 step。
- master gain 做 linear fade-out。
- fade 完後 hardStopAllAudio 清理 activeNodes / AudioContext / flags。
- Stop 後完全安靜。
- 下一次 Start Music 會恢復 master gain。

## 3. Ending chord 處理

- 初版 ending chord 測試失敗：
  - Stop 時會突然冒出很大聲低頻。
  - 淡出變得突兀。
- 已停用 ending chord。
- Stop 時不再新增 oscillator / sample / note。
- 目前策略：
  - 自然 fade-out 優先
  - 不做額外 ending chord

## 4. Hard stop fallback

- 保留 hardStopAllAudio。
- startMusic 初始化 / 錯誤處理仍可用 hard stop。
- 若 AudioContext 不存在或已關閉，smooth stop fallback 到 hard stop。
- 確保不殘留 activeNodes。

## 5. Stop UI 狀態修正

- 修正 Stop 後 Start Music 偶爾保持 disabled 的問題。
- popup.js 新增或修正：
  - hasPlayableCode()
  - hasPlayableSource()
  - setStoppedUiState()
- Stop 回覆後 Start 是否可按，不再只依賴 currentPageData。
- 只要 Live Code textarea 有內容，即可重新 Start，不必重新 Analyze Page。

## 6. Race condition 修正

- 新增 playbackUiRequestId token 或等效機制。
- 防止舊 async callback 把最新 UI 狀態覆蓋成 disabled。
- syncPlaybackState timeout 時也會 fallback 到 setStoppedUiState()。
- 避免 Start 按鈕永久卡灰。

## 7. GET_PLAYBACK_STATE

- offscreen.js 新增 GET_PLAYBACK_STATE handler。
- popup 可查詢：
  - isPlaying
  - isStopping
- 修正原本 syncPlaybackState timeout 的根本原因之一。

## 8. 驗收結果

測試流程：
1. Live Code textarea 有內容
2. Start Music
3. 播放 10-20 秒
4. Stop Music
5. 等 fade-out 完
6. 不重新 Analyze Page
7. 再 Start Music
8. 重複 5 次

驗收：
- Stop 一次就變灰
- fade-out 正常
- Stop 後 Start 會恢復可按
- 連續測 5 次沒有卡灰
- 再 Start 正常
- 再 Stop 正常
- 一開始若尚未 Analyze Page，第一次需要 Analyze Page 可接受；但 Stop 後不再需要反覆 Analyze

## 9. 未修改項目

- 未改 warm / pianoPop 音色
- 未改 Bass V2
- 未改 HH pattern
- 未改 Arrangement Engine
- 未改 Auto Compose
- 未改 manifest / UI 結構 / parser
- 未新增套件

## 10. 下一步建議

- 暫時不要再動 Stop / fade-out。
- 可考慮：
  - Preset selector
  - More warm / pianoPop variation presets
  - Song ending chord 之後再重新設計，但不可在 Stop 當下突兀觸發低頻
  - 更細的 page mood mapping
