# PageSynth Checkpoint v0.2

## 1) 本版目標

v0.2 的核心目標是讓 PageSynth 從「data sonification（資料驅動聲音）」逐步走向「simple song / accompaniment（可聽的簡單歌曲與伴奏）」。

重點不再只是把頁面數據映射成抽象節奏，而是讓使用者在一鍵播放後，能聽到更接近流行/民謠語境的結構：
- 穩定節拍
- 可辨識的和弦進行
- 可持續的分解和弦伴奏

---

## 2) 已完成功能

- One-click Play
- Auto Compose
- `style("simple")`
- `variationSeed`
- Groove Library
- Motif Library
- Music Theory Engine
- `pad("auto")`
- simple / warm / calm 分解和弦伴奏

---

## 3) 目前聲音狀態

- simple / warm 已能聽到分解和弦
- 鼓 / bass / blip 已退後，讓伴奏更容易辨識
- 無明顯怪高音（音域與安全 voicing 已做保護）

---

## 4) 目前限制

- 分解和弦音色仍偏 synth（尚未達到更真實 piano/guitar 質感）
- 整體音量平衡仍需持續微調
- melody 仍不是完整主旋律（偏 motif/裝飾層）
- Play This Page 目前仍較偏背景音樂，而非完整歌曲編曲

---

## 5) 重要技術點

- `playPadArpeggio` 已改為逐顆 note schedule（非單一 chord block）
- simple arp sequence：`root -> fifth -> octaveRoot -> fifth`
- warm arp sequence：`root -> fifth -> third -> fifth`
- simple / warm / calm 已下修 drums / bass / blip，以凸顯分解和弦

---

## 6) 下一步建議

1. 改善分解和弦音色（例如 piano / guitar / pluck sample）
2. 製作 Simple Phrase v1（更像歌曲句法）
3. 增加更多安全的流行/民謠和弦進行
4. 後續再考慮 MIDI motif import
