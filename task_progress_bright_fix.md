# Bright Style Fix - Task Progress

- [x] 分析現有程式碼結構
- [ ] 1. 降低 STYLE_PRESETS.bright 的 blip gain (0.30 → 0.18)
- [ ] 2. getPadArpSampleName 加入 bright case
- [ ] 3. getPadArpSampleCandidates 改善 bright 的 sample candidates
- [ ] 4. getPadArpFallbackSamples 加入 bright case
- [ ] 5. playPadArpeggio: 加入 bright 的 sequence / offsets / gainScale / canUsePhrase
- [ ] 6. sanitizePhraseEventForStyle 加入 bright 的 third/octaveRoot 處理
- [ ] 7. selectPhraseForStyle 加入 bright fallback 到 simple/warm generated phrase
- [ ] 8. scheduleStep 將 bright 納入 playPadArpeggio 路徑
- [ ] 9. 加入 bright 專用 log
- [ ] 10. 驗證 warm/simple 未被改壞
