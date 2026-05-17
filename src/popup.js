/**
 * popup.js - PageSynth 彈出視窗邏輯
 * 
 * 負責：
 * 1. 點擊 Analyze Page 時，透過 chrome.tabs.sendMessage 與 content script 通訊
 *    取得網頁統計資料（若 content script 未回應，則使用 executeScript 直接注入）
 * 2. 顯示網頁統計資料
 * 3. 控制音樂播放（Start / Stop）
 */

// ============================================
// DOM 元素參考
// ============================================
const elements = {
  // 統計資料顯示
  pageTitle: document.getElementById("pageTitle"),
  pageUrl: document.getElementById("pageUrl"),
  wordCount: document.getElementById("wordCount"),
  charCount: document.getElementById("charCount"),
  domCount: document.getElementById("domCount"),
  linkCount: document.getElementById("linkCount"),
  imageCount: document.getElementById("imageCount"),

  // 音樂參數顯示
  paramBpm: document.getElementById("paramBpm"),
  paramDensity: document.getElementById("paramDensity"),
  paramPitch: document.getElementById("paramPitch"),
  paramFilter: document.getElementById("paramFilter"),

  // 按鈕
  analyzeBtn: document.getElementById("analyzeBtn"),
  playPageBtn: document.getElementById("playPageBtn"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  runCodeBtn: document.getElementById("runCodeBtn"),
  resetCodeBtn: document.getElementById("resetCodeBtn"),
  generateCodeBtn: document.getElementById("generateCodeBtn"),
  liveCodeEditor: document.getElementById("liveCodeEditor"),
  modeSelect: document.getElementById("modeSelect"),
  presetSelect: document.getElementById("presetSelect"),
  presetDescription: document.getElementById("presetDescription"),

  // formula summary elements
  formulaStyle: document.getElementById("formulaStyle"),
  formulaPreset: document.getElementById("formulaPreset"),
  formulaChords: document.getElementById("formulaChords"),
  formulaKey: document.getElementById("formulaKey"),
  formulaArp: document.getElementById("formulaArp"),
  formulaBass: document.getElementById("formulaBass"),
  formulaHH: document.getElementById("formulaHH"),
  formulaForm: document.getElementById("formulaForm"),

  // 狀態訊息
  statusMessage: document.getElementById("statusMessage")
};

// Playback state machine
let localPlaybackState = "stopped"; // stopped | starting | playing | stopping
let lastStartAt = 0;

// 儲存目前頁面的資料
let currentPageData = null;
let currentTabId = null;
let isOneClickRunning = false;
const LIVE_CODE_STORAGE_KEY = "pagesynthLiveCode";
const MODE_STORAGE_KEY = "pagesynthMode";
const MODE_PAGE_DATA = "pageData";
const MODE_HYBRID = "hybrid";
const DEFAULT_LIVE_CODE = `style("simple")
bpm(96)
key("A minor")
scale("minorPentatonic")
chords("Am F C G")
kick("x---x---x---x---")
hat("--x---x---x---x-")
bass("auto")
blip("auto")
pad("auto")`;
let currentMode = MODE_HYBRID;

function clampBpm(v) {
  return Math.min(150, Math.max(70, Math.round(v)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizePattern(patternRaw) {
  const compact = String(patternRaw).replace(/\s+/g, "").replace(/X/g, "x");
  if (!/^[x-]*$/.test(compact)) {
    throw new Error("Invalid pattern: only x, X, -, whitespace are allowed");
  }
  return (compact + "----------------").slice(0, 16);
}

function parseNotes(notesRaw) {
  const tokens = String(notesRaw).trim().split(/\s+/).filter(Boolean);
  const valid = /^[A-G](#?)[0-7]$/;
  for (const token of tokens) {
    if (!valid.test(token)) {
      throw new Error(`Invalid note: ${token}`);
    }
  }
  return tokens;
}

function parseKey(value) {
  const m = String(value).trim().match(/^([A-G](?:#)?)\s+(major|minor)$/);
  if (!m) {
    throw new Error("Invalid key: use e.g. key(\"A minor\") or key(\"C major\")");
  }
  return { root: m[1], mode: m[2] };
}

function parseChords(value) {
  const tokens = String(value).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error("Invalid chords: empty");
  }
  const valid = /^[A-G](#?)(m)?$/;
  for (const token of tokens) {
    if (!valid.test(token)) {
      throw new Error(`Invalid chord: ${token}`);
    }
  }
  return tokens;
}

function parseLiveCode(code) {
  const config = {
    style: "warm",
    bpm: 110,
    scale: "minorPentatonic",
    key: { root: "A", mode: "minor" },
    chords: ["Am", "F", "C", "G"],
    kickPattern: "x---x---x---x---",
    hatPattern: "x-x-x-x-x-x-x-x-",
    bassNotes: ["A2", "C3", "D3", "E3"],
    blipNotes: ["C4", "E4", "G4", "A4"],
    bassAuto: false,
    blipAuto: false,
    padAuto: false
  };

  const lines = String(code).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith("//")) continue;

    let m;
    if ((m = raw.match(/^bpm\((\d+)\)$/))) {
      config.bpm = clampBpm(Number(m[1]));
      continue;
    }
    if ((m = raw.match(/^style\("([^"]+)"\)$/))) {
      const style = String(m[1]).trim();
      const allow = ["simple", "warm", "folk", "pianoPop", "bright", "calm", "tech", "ambient", "industrial"];
      if (!allow.includes(style)) {
        throw new Error(`Line ${i + 1}: Invalid style: ${style}`);
      }
      config.style = style;
      continue;
    }
    if ((m = raw.match(/^scale\("(minorPentatonic|majorPentatonic)"\)$/))) {
      config.scale = m[1];
      continue;
    }
    if ((m = raw.match(/^key\("([^"]+)"\)$/))) {
      try { config.key = parseKey(m[1]); } catch (e) { throw new Error(`Line ${i + 1}: ${e.message}`); }
      continue;
    }
    if ((m = raw.match(/^chords\("([^"]+)"\)$/))) {
      try { config.chords = parseChords(m[1]); } catch (e) { throw new Error(`Line ${i + 1}: ${e.message}`); }
      continue;
    }
    if ((m = raw.match(/^kick\("([^"]*)"\)$/))) {
      try { config.kickPattern = normalizePattern(m[1]); } catch (e) { throw new Error(`Line ${i + 1}: ${e.message}`); }
      continue;
    }
    if ((m = raw.match(/^hat\("([^"]*)"\)$/))) {
      try { config.hatPattern = normalizePattern(m[1]); } catch (e) { throw new Error(`Line ${i + 1}: ${e.message}`); }
      continue;
    }
    if ((m = raw.match(/^bass\("([^"]*)"\)$/))) {
      if (String(m[1]).trim() === "auto") {
        config.bassAuto = true;
      } else {
        try { config.bassNotes = parseNotes(m[1]); } catch (e) { throw new Error(`Line ${i + 1}: ${e.message}`); }
        config.bassAuto = false;
      }
      continue;
    }
    if ((m = raw.match(/^blip\("([^"]*)"\)$/))) {
      if (String(m[1]).trim() === "auto") {
        config.blipAuto = true;
      } else {
        try { config.blipNotes = parseNotes(m[1]); } catch (e) { throw new Error(`Line ${i + 1}: ${e.message}`); }
        config.blipAuto = false;
      }
      continue;
    }
    if ((m = raw.match(/^pad\("([^"]*)"\)$/))) {
      if (String(m[1]).trim() === "auto") {
        config.padAuto = true;
      } else {
        throw new Error(`Line ${i + 1}: Invalid pad: only pad("auto") is supported`);
      }
      continue;
    }

    throw new Error(`Line ${i + 1}: Unknown command`);
  }

  return config;
}

function getDeterministicSeedFromPageData(pageData) {
  const base = `${pageData?.title || ""}|${pageData?.url || ""}|${pageData?.wordCount || 0}|${pageData?.domCount || 0}|${pageData?.linkCount || 0}|${pageData?.imageCount || 0}`;
  let hash = 2166136261;
  for (let i = 0; i < base.length; i++) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function createVariationSeed() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0];
}

function mixSeed(baseSeed, variationSeed = 0) {
  const v = Number(variationSeed || 0) >>> 0;
  return ((baseSeed ^ v) >>> 0) || 1;
}

function pickBySeed(seed, list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[Math.abs(seed) % list.length];
}

// --- Preset System v1.3 Rich ---
const PAGE_SYNTH_PRESETS = {
  auto: {
    style: null, bpmRange: null, chords: null, kick: null, hat: null,
    desc: "Choose Warm or PianoPop based on the current page.",
    bestFor: "Quick playback when you want PageSynth to decide.",
    sound: "Uses stable Warm or PianoPop templates only.",
    rhythm: "Depends on the detected page type.",
    mood: "Safe, adaptive, conservative.",
    notes: "Auto avoids Bright, Tech, and Industrial by default."
  },
  warmClean: {
    style: "warm", bpmRange: [90, 94],
    chords: ["Am F C G", "C G Am F", "C F G C"],
    kick: "----------------", hat: "----------------",
    desc: "Warm nylon guitar background with minimal rhythm.",
    bestFor: "General articles, quiet reading, low-distraction background music.",
    sound: "Nylon guitar arpeggio, subtle body layer, soft synth bass.",
    rhythm: "Minimal. No default hi-hat or kick.",
    mood: "Clean, warm, calm.",
    notes: "The safest background preset."
  },
  pianoPopFlow: {
    style: "pianoPop", bpmRange: [96, 100],
    chords: ["Am F C G", "C G Am F", "Em C G D"],
    kick: "----------------", hat: "x---x---x---x---",
    desc: "Flowing piano arpeggio with light hi-hat.",
    bestFor: "Long articles, stories, essays, and pages that need more movement.",
    sound: "Casio piano arpeggio, synth bass, light closed hi-hat.",
    rhythm: "Light flowing hi-hat pattern, no kick, snare, or clap.",
    mood: "Moving, warm, slightly emotional.",
    notes: "Current main preset."
  },
  pianoPopSoft: {
    style: "pianoPop", bpmRange: [88, 94],
    chords: ["C F G C", "Am F C G", "C G Am F"],
    kick: "----------------", hat: "----------------",
    desc: "Quiet piano arpeggio for reading, with no hi-hat.",
    bestFor: "Reading, study, quiet browsing, and low-energy pages.",
    sound: "Soft piano arpeggio and synth bass.",
    rhythm: "Very minimal. Hi-hat is disabled.",
    mood: "Gentle, quiet, spacious.",
    notes: "Choose this when PianoPop Flow feels too active."
  },
  pianoPopStory: {
    style: "pianoPop", bpmRange: [90, 96],
    chords: ["Am F C G", "Em C G D", "Am G F G"],
    kick: "----------------", hat: "x---x---x---x---",
    desc: "Slower emotional piano background for long-form writing.",
    bestFor: "Personal writing, reflective stories, long-form essays.",
    sound: "Slower piano arpeggio with emotional chord choices.",
    rhythm: "Light hi-hat support, slower than Flow.",
    mood: "Reflective, narrative, emotional.",
    notes: "Good for content with memory, journey, life, or story feeling."
  },
  pianoPopMotion: {
    style: "pianoPop", bpmRange: [98, 106],
    chords: ["C G Am F", "G D Em C", "Am F C G"],
    kick: "----------------", hat: "xx-x-x-xxx-x-x-x",
    desc: "More movement and light rhythm, still not dance.",
    bestFor: "Pages that need energy and forward motion without dance drums.",
    sound: "Piano arpeggio, synth bass, more active closed hi-hat.",
    rhythm: "Most active PianoPop preset, but still no kick, snare, or clap.",
    mood: "Focused, moving, lively.",
    notes: "Use when Flow feels too calm."
  },
  storyPiano: {
    style: "pianoPop", bpmRange: [92, 96],
    chords: ["Am F C G", "Em C G D", "Am G F G"],
    kick: "----------------", hat: "x---x---x---x---",
    desc: "Gentle piano mood for stories and reflective articles.",
    bestFor: "Stories, emotional articles, essays, and reflective content.",
    sound: "PianoPop-based with slower BPM and emotional chord progressions.",
    rhythm: "Light and supportive.",
    mood: "Gentle, sentimental, thoughtful.",
    notes: "Older story-oriented piano preset, kept for compatibility."
  },
  studyWarm: {
    style: "warm", bpmRange: [88, 92],
    chords: ["C F G C", "C G Am F", "G D Em C"],
    kick: "----------------", hat: "----------------",
    desc: "Stable warm background for learning and documentation.",
    bestFor: "Tutorials, documentation, learning pages, school-related content.",
    sound: "Warm nylon guitar with stable chord progressions.",
    rhythm: "Minimal and non-distracting.",
    mood: "Stable, clear, focused.",
    notes: "Good for reading technical or educational material."
  },
  foodLifeWarm: {
    style: "warm", bpmRange: [90, 94],
    chords: ["C F G C", "C G Am F", "Am F C G"],
    kick: "----------------", hat: "----------------",
    desc: "Light warm accompaniment for food, health, and daily life pages.",
    bestFor: "Food, health, lifestyle, and daily-life pages.",
    sound: "Warm nylon guitar with friendly chord choices.",
    rhythm: "Minimal.",
    mood: "Friendly, light, comfortable.",
    notes: "Good for casual reading and lifestyle pages."
  },
  minimalWarm: {
    style: "warm", bpmRange: [86, 90],
    chords: ["C F G C", "Am F C G"],
    kick: "----------------", hat: "----------------",
    desc: "The least distracting warm background.",
    bestFor: "Maximum focus, background ambience, pages where music should almost disappear.",
    sound: "Very simple warm guitar accompaniment.",
    rhythm: "Almost none.",
    mood: "Neutral, calm, unobtrusive.",
    notes: "Good fallback when everything else feels too active."
  }
};
const PRESET_STORAGE_KEY = "pagesynthPreset";

function generateFromPreset(presetKey, seed) {
  const preset = PAGE_SYNTH_PRESETS[presetKey];
  if (!preset) return null;
  const styleName = preset.style;
  const [minBpm, maxBpm] = preset.bpmRange;
  const bpm = minBpm + (Math.abs(seed) % (maxBpm - minBpm + 1));
  const chordsText = preset.chords[Math.abs(seed >>> 3) % preset.chords.length];
  const keyInfo = inferKeyFromChords(chordsText);
  return {
    styleName, bpm, chordsText,
    keyText: keyInfo.key, scaleText: keyInfo.scale,
    kickPattern: preset.kick, hatPattern: preset.hat
  };
}

function generateCodeFromPreset(presetKey, seed) {
  const p = generateFromPreset(presetKey, seed);
  if (!p) return generateLiveCodeFromPage(currentPageData || {});
  const code = [
    `style("${p.styleName}")`,
    `bpm(${p.bpm})`,
    `key("${p.keyText}")`,
    `scale("${p.scaleText}")`,
    `chords("${p.chordsText}")`,
    `kick("${p.kickPattern}")`,
    `hat("${p.hatPattern}")`,
    `bass("auto")`,
    `blip("auto")`,
    `pad("auto")`
  ].join("\n");
  console.log("[PageSynth Preset] generated code:", code);
  return code;
}

function classifyPageMood(pageData) {
  // v0.8: return mood and topic for chord progression selection
  const text = `${pageData?.title || ""} ${pageData?.bodyText || ""}`.toLowerCase();
  const hasAny = (arr) => arr.some((k) => text.includes(k));
  const wordCount = Number(pageData?.wordCount || 0);

  // topic detection
  let topic = "general";
  const learningKw = ["learn", "learning", "tutorial", "guide", "education", "school", "course", "how to", "課程", "教學", "學習", "教育", "指南", "說明", "documentation", "開發", "api", "code"];
  const foodLifeKw = ["food", "recipe", "cooking", "kitchen", "meal", "baking", "飲食", "食物", "食譜", "料理", "廚房", "health", "healthy", "life", "lifestyle", "健康", "生活"];
  const emotionalKw = ["story", "essay", "personal", "memory", "journey", "reflect", "feeling", "emotion", "故事", "散文", "回憶", "心情", "旅程", "反思", "感想", "心得", "日記", "隨筆", "遊記"];
  const calmKw = ["meditation", "calm", "sleep", "nature", "slow", "quiet", "peace", "放鬆", "睡眠", "冥想", "自然", "安靜", "藝術", "設計", "art", "design", "music", "音樂", "文化", "culture", "閱讀"];

  if (hasAny(learningKw)) topic = "learning";
  if (hasAny(foodLifeKw)) topic = "foodLife";
  if (hasAny(emotionalKw)) topic = "emotional";
  if (hasAny(calmKw)) topic = "calm";

  // mood classification
  let mood = "general";
  if (wordCount >= 800) mood = "longform";
  else if (wordCount >= 400 && (topic === "emotional" || topic === "foodLife")) mood = "longform";
  else if (topic === "emotional") mood = "story";
  else if (topic === "calm" || topic === "learning") mood = "calm";

  return { mood, topic, wordCount };
}

// --- Chord Progression Library v0.8 ---
const CHORD_PROGRESSIONS = {
  warm: {
    gentle:    ["Am F C G", "C F G C", "C G Am F"],
    folk:      ["Am G F G", "C F C G", "G D Em C"],
    hopeful:   ["C G Am F", "G D Em C", "C F G C"],
    reflective:["Am F C G", "Em C G D", "Am G F G"],
    learning:  ["C F G C", "C G Am F", "G D Em C"],
    foodLife:  ["C F G C", "Am F C G", "C G Am F"]
  },
  pianoPop: {
    ballad:    ["Am F C G", "C G Am F", "Em C G D"],
    emotional: ["Am F C G", "Em C G D", "Am G F G"],
    longform:  ["Am F C G", "C G Am F", "G D Em C"],
    hopeful:   ["C G Am F", "G D Em C", "C F G C"],
    calmFlow:  ["C F G C", "Am F C G", "C G Am F"]
  }
};

function selectChordProgressionForPage(styleName, moodInfo, seed) {
  const { mood, topic } = moodInfo;
  const lib = CHORD_PROGRESSIONS[styleName] || CHORD_PROGRESSIONS.warm;
  let category = "gentle";

  if (styleName === "warm") {
    if (topic === "learning") category = "learning";
    else if (topic === "foodLife") category = "foodLife";
    else if (topic === "emotional" || mood === "story" || mood === "longform") category = (seed % 2 === 0) ? "reflective" : "folk";
    else if (topic === "calm") category = "gentle";
    else category = "gentle";
  } else if (styleName === "pianoPop") {
    if (mood === "longform" || topic === "emotional") category = (seed % 2 === 0) ? "ballad" : "emotional";
    else if (topic === "learning") category = "longform";
    else if (topic === "foodLife") category = (seed % 2 === 0) ? "hopeful" : "calmFlow";
    else if (topic === "calm") category = "calmFlow";
    else category = "ballad";
  }

  const pool = lib[category] || lib.gentle;
  const chordsText = pool[Math.abs(seed >>> 3) % pool.length];
  return { chordsText, category };
}

function inferKeyFromChords(chordsText) {
  const tokens = String(chordsText).trim().split(/\s+/);
  const first = tokens[0] || "Am";
  if (first.includes("m")) {
    const root = first.replace("m", "");
    if (root === "A") return { key: "A minor", scale: "minorPentatonic" };
    if (root === "E") return { key: "E minor", scale: "minorPentatonic" };
    if (root === "D") return { key: "D minor", scale: "minorPentatonic" };
    return { key: "A minor", scale: "minorPentatonic" };
  }
  if (first === "C") return { key: "C major", scale: "majorPentatonic" };
  if (first === "G") return { key: "G major", scale: "majorPentatonic" };
  if (first === "D") return { key: "D major", scale: "majorPentatonic" };
  return { key: "C major", scale: "majorPentatonic" };
}

function generateLiveCodeFromPage(pageData) {
  const moodInfo = classifyPageMood(pageData);
  const baseSeed = getDeterministicSeedFromPageData(pageData);
  const seed = mixSeed(baseSeed, pageData?.variationSeed || 0);
  const wordCount = Number(pageData?.wordCount || 0);

  // --- style selection (v0.6: warm / pianoPop only) ---
  let styleName = "warm";
  let reason = "default warm";

  if (moodInfo.mood === "longform") {
    // longform: 60% pianoPop / 40% warm
    styleName = (seed % 5 < 3) ? "pianoPop" : "warm";
    reason = styleName === "pianoPop" ? "longform pianoPop" : "longform warm";
  } else if (moodInfo.mood === "story") {
    // story: 50% pianoPop / 50% warm
    styleName = (seed % 2 === 0) ? "pianoPop" : "warm";
    reason = styleName === "pianoPop" ? "story pianoPop" : "story warm";
  } else {
    // general: 70% warm / 30% pianoPop
    styleName = (seed % 10 < 7) ? "warm" : "pianoPop";
    reason = styleName === "pianoPop" ? "general pianoPop" : "general warm";
  }

  // --- presets (v0.6.1: warm clean, pianoPop light-hh) ---
  const presets = {
    warm: { bpmRange: [88, 94] },
    pianoPop: { bpmRange: [94, 100] }
  };

  const preset = presets[styleName] || presets.warm;
  const [minBpm, maxBpm] = preset.bpmRange;
  const baseBpm = minBpm === maxBpm ? minBpm : (minBpm + (seed % (maxBpm - minBpm + 1)));
  const wordOffset = clamp(Math.round(((wordCount - 900) / 900) * 6), -6, 6);
  const variationBpm = ((seed >>> 9) % 9) - 4;
  const bpm = clampBpm(baseBpm + wordOffset + variationBpm);

  // --- chord progression selection v0.8 ---
  const progression = selectChordProgressionForPage(styleName, moodInfo, seed);
  const chordsText = progression.chordsText;
  const keyInfo = inferKeyFromChords(chordsText);
  const keyText = keyInfo.key;
  const scaleText = keyInfo.scale;

  const kickPattern = "----------------";
  const hatPattern = styleName === "pianoPop" ? "x---x---x---x---" : "----------------";

  const code = [
    `style("${styleName}")`,
    `bpm(${bpm})`,
    `key("${keyText}")`,
    `scale("${scaleText}")`,
    `chords("${chordsText}")`,
    `kick("${kickPattern}")`,
    `hat("${hatPattern}")`,
    `bass("auto")`,
    `blip("auto")`,
    `pad("auto")`
  ].join("\n");

  console.log("[PageSynth AutoCompose v0.8] moodInfo:", moodInfo);
  console.log("[PageSynth AutoCompose v0.8] selected progression:", progression.chordsText, `(${progression.category})`);
  console.log("[PageSynth AutoCompose v0.8] style/key/scale:", `${styleName} / ${keyText} / ${scaleText}`);
  console.log("[PageSynth AutoCompose v0.8] reason:", reason);
  console.log("[PageSynth AutoCompose v0.8] generated code:", code);
  return code;
}

/**
 * 安全發送訊息（Promise 版）
 * @param {Object} message
 * @returns {Promise<Object>}
 */
function sendMessageSafe(message, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, timeout: true, error: "message timeout" });
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (done) return;
        done = true;
        clearTimeout(timer);

        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: "empty response" });
      });
    } catch (error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, error: String(error.message || error) });
    }
  });
}

// ============================================
// 工具函式
// ============================================

/**
 * 顯示狀態訊息
 * @param {string} message - 訊息內容
 * @param {string} type - 訊息類型（success / error / info）
 */
function showStatus(message, type = "info") {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = "status-message";
  if (type) {
    elements.statusMessage.classList.add(`status-message--${type}`);
  }
}

/**
 * 更新音樂參數顯示
 * @param {Object} data - 網頁統計資料
 */
function updateMusicParams(data) {
  if (!data) return;

  // wordCount → BPM（範圍 70~150）
  // 字數越多 BPM 越快
  const bpm = clampBpm(Math.round(data.wordCount / 8 + 70));
  elements.paramBpm.textContent = bpm;

  // domCount → 節奏密度
  // DOM 元素越多，節奏越密集
  const density = data.domCount;
  let densityLabel = "低";
  if (density > 500) densityLabel = "中";
  if (density > 1500) densityLabel = "高";
  if (density > 3000) densityLabel = "極高";
  elements.paramDensity.textContent = densityLabel;

  // linkCount → 音高偏移（半音）
  // 連結越多，音高偏移越大
  const pitchOffset = Math.min(12, Math.round(data.linkCount / 5));
  elements.paramPitch.textContent = `+${pitchOffset}`;

  // imageCount → 濾波器 cutoff（百分比）
  // 圖片越多，濾波器越開
  const filterCutoff = Math.min(100, Math.round(data.imageCount * 5));
  elements.paramFilter.textContent = `${filterCutoff}%`;
}

/**
 * 更新統計資料顯示
 * @param {Object} data - 網頁統計資料
 */
function updateStats(data) {
  elements.pageTitle.textContent = data.title;
  elements.pageUrl.textContent = data.url;
  elements.wordCount.textContent = data.wordCount.toLocaleString();
  elements.charCount.textContent = data.charCount.toLocaleString();
  elements.domCount.textContent = data.domCount.toLocaleString();
  elements.linkCount.textContent = data.linkCount.toLocaleString();
  elements.imageCount.textContent = data.imageCount.toLocaleString();
}

// ============================================
// 按鈕事件處理
// ============================================

function isUnsupportedUrl(url) {
  return !url || /^chrome:\/\//i.test(url) || /^edge:\/\//i.test(url) || /^about:/i.test(url);
}

function setOneClickRunning(running) {
  isOneClickRunning = running;
  if (!elements.playPageBtn) return;
  elements.playPageBtn.disabled = running;
  elements.playPageBtn.innerHTML = running
    ? '<span class="loading"></span> Playing...'
    : '<span class="btn-icon">🎶</span> Play This Page';
}

async function analyzeCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error("Unable to get current tab info");
  }
  if (isUnsupportedUrl(tab.url)) {
    throw new Error("Cannot analyze this page. Please try a standard web page.");
  }
  currentTabId = tab.id;

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectPageData
  });
  if (!results || !results[0] || !results[0].result) {
    throw new Error("Failed to collect page data");
  }

  currentPageData = results[0].result;
  updateStats(currentPageData);
  updateMusicParams(currentPageData);
  elements.startBtn.disabled = false;
  return currentPageData;
}

async function applyLiveCode(code) {
  const config = parseLiveCode(code);
  await chrome.storage.local.set({ [LIVE_CODE_STORAGE_KEY]: code });
  const response = await sendMessageSafe({ action: "SET_LIVE_CODE_CONFIG", config });
  if (!response?.ok) {
    throw new Error(`Live Code apply failed: ${response?.error || "unknown error"}`);
  }
  return true;
}

async function startMusicFromCurrentPageData() {
  if (!currentPageData) {
    throw new Error("Please Analyze Page first");
  }

  localPlaybackState = "starting";
  lastStartAt = Date.now();
  applyPlaybackUiState("start-request");
  console.log("[PageSynth Popup] start entry: start-button");

  let startResponse = null;
  let watchdogTriggered = false;
  let observedPlaying = false;
  const startWatchdog = setTimeout(async () => {
    watchdogTriggered = true;
    const synced = await syncPlaybackState();
    if (synced?.ok && synced?.isPlaying) {
      observedPlaying = true;
      localPlaybackState = "playing";
      applyPlaybackUiState("start-watchdog");
      if (!isOneClickRunning) showStatus("🎵 Playing...", "success");
    }
  }, 1200);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id ?? currentTabId;
    const url = tab?.url || currentPageData.url || "";

    startResponse = await sendMessageSafe({
      action: "startMusic",
      tabId,
      url,
      pageData: currentPageData,
      mode: currentMode
    }, 5000);

    console.log("[PageSynth Popup] start response:", startResponse);
    if (startResponse?.ok === false && !startResponse?.stale) {
      const msg = startResponse.error === "offscreen not ready or missing"
        ? "Start failed: audio backend not ready. Try again."
        : `Start failed: ${startResponse.error}`;
      throw new Error(msg);
    }

    // optimistic: start succeeded, set playing UI immediately
    if (startResponse?.ok === true) {
      localPlaybackState = "playing";
      applyPlaybackUiState("start-ok");
      if (!isOneClickRunning) showStatus("🎵 Playing...", "success");
    }
  } finally {
    clearTimeout(startWatchdog);
  }

  // async verify (best effort)
  const syncResult = await syncPlaybackState();
  if (syncResult?.ok && syncResult?.isPlaying) {
    localPlaybackState = "playing";
    applyPlaybackUiState("start-sync-ok");
    return { ok: true, isPlaying: true };
  }
  if (startResponse?.ok === true && syncResult?.ok === false) {
    localPlaybackState = "playing";
    applyPlaybackUiState("start-sync-fail-but-ok");
    return { ok: true, isPlaying: true };
  }
  if ((startResponse?.ok === false || startResponse?.timeout) && observedPlaying) {
    localPlaybackState = "playing";
    applyPlaybackUiState("start-watchdog-saved");
    return { ok: true, isPlaying: true };
  }
  if (!watchdogTriggered && !syncResult?.ok) {
    return { ok: false, message: "Starting... synchronizing state..." };
  }
  return { ok: false, message: "Start failed. Please try again." };
}

/**
 * Analyze Page - 分析目前網頁
 * 
 * 使用 chrome.scripting.executeScript 在目前分頁執行 content script，
 * 取得網頁統計資料。
 */
elements.analyzeBtn.addEventListener("click", async () => {
  try {
    // 顯示載入狀態
    elements.analyzeBtn.disabled = true;
    elements.analyzeBtn.innerHTML = '<span class="loading"></span> Analyzing...';
    showStatus("Analyzing page...", "info");

    await analyzeCurrentPage();

    showStatus("✅ Page analysis complete!", "success");
  } catch (error) {
    console.error("Page analysis failed:", error);
    showStatus(`❌ Analysis failed: ${error.message}`, "error");
  } finally {
    // 恢復按鈕狀態
    elements.analyzeBtn.disabled = false;
    elements.analyzeBtn.innerHTML = '<span class="btn-icon">🔍</span> Analyze Page';
  }
});

/**
 * 在目標頁面執行的資料收集函式
 * 這個函式會被序列化後注入到目標頁面執行
 * @returns {Object} 網頁統計資料
 */
function collectPageData() {
  const textContent = document.body?.innerText || "";
  const words = textContent.trim()
    ? textContent.trim().split(/\s+/).length
    : 0;

  return {
    title: document.title || "(無標題)",
    url: location.href || "",
    bodyText: textContent.slice(0, 200),
    wordCount: words,
    charCount: textContent.replace(/\s/g, "").length,
    domCount: document.querySelectorAll("*").length,
    linkCount: document.querySelectorAll("a").length,
    imageCount: document.querySelectorAll("img").length
  };
}

/**
 * Start Music - 開始播放音樂
 * 
 * 將網頁資料送到 background.js，由它轉發到 offscreen.js 開始播放。
 */
elements.startBtn.addEventListener("click", async () => {
  if (!currentPageData) {
    showStatus("Please Analyze Page first", "error");
    return;
  }
  showStatus("🎵 Starting music...", "info");
  try {
    const result = await startMusicFromCurrentPageData();
    if (result?.ok && result?.isPlaying) {
      showStatus("🎵 Playing...", "success");
    } else {
      showStatus(result?.message || "Starting... syncing...", "info");
    }
  } catch (error) {
    showStatus(`❌ Start failed: ${String(error.message || error)}`, "error");
  }
});

elements.modeSelect?.addEventListener("change", async () => {
  try {
    const mode = elements.modeSelect.value === MODE_PAGE_DATA ? MODE_PAGE_DATA : MODE_HYBRID;
    currentMode = mode;
    await chrome.storage.local.set({ [MODE_STORAGE_KEY]: mode });
    showStatus(mode === MODE_PAGE_DATA ? "🎚 Mode: Page Data" : "🎚 Mode: Hybrid Code", "info");
  } catch (error) {
    showStatus(`❌ Mode save failed: ${error.message || error}`, "error");
  }
});

elements.presetSelect?.addEventListener("change", async () => {
  try {
    const presetKey = elements.presetSelect.value || "auto";
    await chrome.storage.local.set({ [PRESET_STORAGE_KEY]: presetKey });
    console.log("[PageSynth Preset] saved:", presetKey);
    showStatus(`🎚 Preset: ${presetKey === "auto" ? "Auto" : presetKey}`, "info");
    updatePresetDescription(presetKey);
  } catch (error) {
    showStatus(`❌ Preset save failed: ${error.message || error}`, "error");
  }
});

function updatePresetDescription(presetKey) {
  const preset = PAGE_SYNTH_PRESETS[presetKey];
  if (!elements.presetDescription) return;
  if (!preset) {
    elements.presetDescription.innerHTML = "<em>Auto — Choose Warm or PianoPop based on the current page.</em>";
    return;
  }
  const label = presetKey === "auto" ? "Auto" : getPresetDisplayName(presetKey);
  const html = `<div class="preset-guide-title">${escHtml(label)}</div>
    <div class="preset-guide-desc">${escHtml(preset.desc || "")}</div>
    <div class="preset-guide-grid">
      <div class="preset-guide-row"><span class="preset-guide-label">Best for</span><span class="preset-guide-value">${escHtml(preset.bestFor || "—")}</span></div>
      <div class="preset-guide-row"><span class="preset-guide-label">Sound</span><span class="preset-guide-value">${escHtml(preset.sound || "—")}</span></div>
      <div class="preset-guide-row"><span class="preset-guide-label">Rhythm</span><span class="preset-guide-value">${escHtml(preset.rhythm || "—")}</span></div>
      <div class="preset-guide-row"><span class="preset-guide-label">Mood</span><span class="preset-guide-value">${escHtml(preset.mood || "—")}</span></div>
    </div>
    <div class="preset-guide-notes">${escHtml(preset.notes || "")}</div>`;
  elements.presetDescription.innerHTML = html;
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;");
}

function getPresetDisplayName(key) {
  const map = {
    auto: "Auto", warmClean: "Warm Clean", pianoPopFlow: "PianoPop Flow",
    pianoPopSoft: "PianoPop Soft", pianoPopStory: "PianoPop Story",
    pianoPopMotion: "PianoPop Motion", storyPiano: "Story Piano",
    studyWarm: "Study Warm", foodLifeWarm: "Food Life Warm",
    minimalWarm: "Minimal Warm"
  };
  return map[key] || key;
}

// ── Formula Summary v1.4B ──
const FORMULA_PRESET_MAP = {
  auto:        { arp:"(auto)", bass:"(auto)", hh:"(auto)", form:"32-bar Intro/Main/Variation/Break/Return" },
  warmClean:   { arp:"Warm Nylon Arpeggio", bass:"Simple Root", hh:"Off", form:"32-bar Intro/Main/Variation/Break/Return" },
  pianoPopFlow:{ arp:"Flow Basic", bass:"Root Pulse", hh:"Flow", form:"32-bar Intro/Main/Variation/Break/Return" },
  pianoPopSoft:{ arp:"Soft Sparse", bass:"Root Pulse", hh:"Off", form:"32-bar Intro/Main/Variation/Break/Return" },
  pianoPopStory:{ arp:"Ballad Rolling", bass:"Root Pulse", hh:"Story", form:"32-bar Intro/Main/Variation/Break/Return" },
  pianoPopMotion:{ arp:"Broken Up", bass:"Root Pulse", hh:"Motion", form:"32-bar Intro/Main/Variation/Break/Return" },
  storyPiano:  { arp:"Ballad Rolling", bass:"Root Pulse", hh:"Story", form:"32-bar Intro/Main/Variation/Break/Return" },
  studyWarm:   { arp:"Warm Nylon Arpeggio", bass:"Simple Root", hh:"Off", form:"32-bar Intro/Main/Variation/Break/Return" },
  foodLifeWarm:{ arp:"Warm Nylon Arpeggio", bass:"Simple Root", hh:"Off", form:"32-bar Intro/Main/Variation/Break/Return" },
  minimalWarm: { arp:"Warm Nylon Arpeggio", bass:"Simple Root", hh:"Off", form:"32-bar Intro/Main/Variation/Break/Return" }
};

function updateFormulaSummary(styleName, chordsText, keyText, scaleText, presetKey) {
  const fm = FORMULA_PRESET_MAP[presetKey] || FORMULA_PRESET_MAP.auto;
  const displayName = getPresetDisplayName(presetKey || "auto");
  const set = (el, v) => { if (el) el.textContent = v || "—"; };
  set(elements.formulaStyle, styleName || "—");
  set(elements.formulaPreset, displayName);
  set(elements.formulaChords, chordsText || "—");
  set(elements.formulaKey, (keyText && scaleText) ? `${keyText} / ${scaleText}` : "—");
  set(elements.formulaArp, fm.arp);
  set(elements.formulaBass, fm.bass);
  set(elements.formulaHH, fm.hh);
  set(elements.formulaForm, fm.form);
}

function updateFormulaSummaryFromCode(code) {
  try {
    const parsed = parseLiveCode(code);
    const styleName = (parsed.style || parsed._style || "warm").toLowerCase();
    const chordsText = (parsed.chords || parsed._chords || "").trim();
    const keyText = (parsed.key || parsed._key || "").trim();
    const scaleText = (parsed.scale || parsed._scale || "").trim();
    const hat = (parsed.hat || parsed._hat || "----------------").trim();
    let guessedPreset = "auto";
    if (styleName === "warm") {
      guessedPreset = "warmClean";
    } else if (styleName === "pianopop") {
      if (hat === "----------------") guessedPreset = "pianoPopSoft";
      else if (hat === "xx-x-x-xxx-x-x-x" || hat.includes("xx-x-x-xxx")) guessedPreset = "pianoPopMotion";
      else if (hat === "x---x-x-x---x-x-" || hat.includes("x---x-x-x")) guessedPreset = "pianoPopStory";
      else guessedPreset = "pianoPopFlow";
    }
    if (!PAGE_SYNTH_PRESETS[guessedPreset]) guessedPreset = "auto";
    updateFormulaSummary(styleName, chordsText, keyText, scaleText, guessedPreset);
    console.log("[PageSynth Formula] summary updated from code");
  } catch (_) {}
}

let playbackUiRequestId = 0;

function hasPlayableCode() {
  try { return String(elements.liveCodeEditor?.value || "").trim().length > 0; } catch (_) { return false; }
}
function hasPlayableSource() {
  return Boolean(currentPageData) || hasPlayableCode();
}
function applyPlaybackUiState(reason = "") {
  if (reason) console.log("[PageSynth Popup] applyPlaybackUiState:", reason, localPlaybackState);

  const hasCode = hasPlayableCode();
  const hasSource = hasPlayableSource();

  if (localPlaybackState === "starting") {
    elements.startBtn.disabled = true;
    elements.runCodeBtn.disabled = true;
    elements.playPageBtn.disabled = true;
    elements.stopBtn.disabled = false;
    return;
  }
  if (localPlaybackState === "playing") {
    elements.startBtn.disabled = true;
    elements.runCodeBtn.disabled = true;
    if (!isOneClickRunning) {
      elements.playPageBtn.disabled = true;
      elements.playPageBtn.innerHTML = '<span class="btn-icon">🎶</span> Playing...';
    }
    elements.stopBtn.disabled = false;
    return;
  }
  if (localPlaybackState === "stopping") {
    elements.startBtn.disabled = true;
    elements.runCodeBtn.disabled = true;
    elements.playPageBtn.disabled = true;
    elements.stopBtn.disabled = true;
    return;
  }
  // stopped
  elements.stopBtn.disabled = true;
  elements.startBtn.disabled = !hasSource;
  elements.runCodeBtn.disabled = !hasCode;
  if (!isOneClickRunning) {
    elements.playPageBtn.disabled = !hasSource;
    elements.playPageBtn.innerHTML = '<span class="btn-icon">🎶</span> Play This Page';
  }
}

// legacy aliases
function setPlayingUiState(reason = "") { localPlaybackState = "playing"; applyPlaybackUiState(reason); }
function setStoppedUiState(reason = "") { localPlaybackState = "stopped"; applyPlaybackUiState(reason); }

/**
 * Stop Music - 停止播放音樂
 */
elements.stopBtn.addEventListener("click", async () => {
  const reqId = ++playbackUiRequestId;
  localPlaybackState = "stopping";
  applyPlaybackUiState("stop-request");
  console.log("[PageSynth Popup] stop clicked");
  showStatus("⏹ Stopping...", "info");
  try {
    const stopResponse = await sendMessageSafe({ action: "stopMusic" }, 5000);
    if (reqId !== playbackUiRequestId) {
      console.log("[PageSynth Popup] stop stale, still finalizing state");
    }
    if (stopResponse?.ok === true) {
      localPlaybackState = "stopped";
      applyPlaybackUiState("stop-ok");
      showStatus("⏹ Music stopped", "info");
    } else {
      // even on error response, mark stopped so UI recovers
      localPlaybackState = "stopped";
      applyPlaybackUiState("stop-error");
      showStatus(`❌ Stop failed: ${stopResponse?.error || "unknown"}`, "error");
    }
  } catch (error) {
    localPlaybackState = "stopped";
    applyPlaybackUiState("stop-finally");
    showStatus(`❌ Stop failed: ${error.message || error}`, "error");
  }
  // async verify (best effort, don't block UI)
  console.log("[PageSynth Popup] stop response processed, final state:", localPlaybackState);
  syncPlaybackState("bg-after-stop").catch(() => {});
});

elements.runCodeBtn.addEventListener("click", async () => {
  if (localPlaybackState === "starting" || localPlaybackState === "playing" || localPlaybackState === "stopping") return;
  console.log("[PageSynth Popup] start entry: run-code");
  try {
    const code = elements.liveCodeEditor.value;
    await applyLiveCode(code);
    console.log("[PageSynth] live code config updated");
    updateFormulaSummaryFromCode(code);
    showStatus("✅ Live Code updated", "success");
  } catch (error) {
    showStatus(`❌ ${error.message || error}`, "error");
  }
});

elements.resetCodeBtn.addEventListener("click", async () => {
  try {
    elements.liveCodeEditor.value = DEFAULT_LIVE_CODE;
    const config = parseLiveCode(DEFAULT_LIVE_CODE);
    await chrome.storage.local.set({ [LIVE_CODE_STORAGE_KEY]: DEFAULT_LIVE_CODE });
    await sendMessageSafe({ action: "SET_LIVE_CODE_CONFIG", config });
    showStatus("🔄 Live Code reset", "info");
  } catch (error) {
    showStatus(`❌ Reset failed: ${error.message || error}`, "error");
  }
});

elements.generateCodeBtn?.addEventListener("click", async () => {
  try {
    if (!currentPageData) {
      showStatus("Please Analyze Page first", "error");
      return;
    }
    const variationSeed = createVariationSeed();
    const pageDataForGen = { ...currentPageData, variationSeed };
    const presetKey = elements.presetSelect?.value || "auto";
    let code;
    if (presetKey === "auto") {
      code = generateLiveCodeFromPage(pageDataForGen);
    } else {
      const seed = getDeterministicSeedFromPageData(pageDataForGen);
      const mixed = mixSeed(seed, variationSeed);
      code = generateCodeFromPreset(presetKey, mixed);
      console.log("[PageSynth Preset] selected:", presetKey);
      console.log("[PageSynth Preset] variation:", { variationSeed });
    }
    currentPageData = pageDataForGen;
    elements.liveCodeEditor.value = code;
    await chrome.storage.local.set({ [LIVE_CODE_STORAGE_KEY]: code });
    updateFormulaSummaryFromCode(code);
    showStatus("✅ Generated from page. Press Run Code.", "success");
  } catch (error) {
    showStatus(`❌ Generation failed: ${error.message || error}`, "error");
  }
});

elements.playPageBtn?.addEventListener("click", async () => {
  if (localPlaybackState === "starting" || localPlaybackState === "playing" || localPlaybackState === "stopping") return;
  if (isOneClickRunning) return;
  setOneClickRunning(true);
  console.log("[PageSynth Popup] start entry: play-this-page");
  try {
    showStatus("Analyzing page...", "info");
    const pageData = await analyzeCurrentPage();
    const variationSeed = createVariationSeed();
    const variedPageData = { ...pageData, variationSeed };
    currentPageData = variedPageData;
    console.log("[PageSynth AutoCompose v0.8] variationSeed:", variationSeed);

    showStatus("Generating music...", "info");
    const presetKey = elements.presetSelect?.value || "auto";
    let code;
    if (presetKey === "auto") {
      code = generateLiveCodeFromPage(variedPageData);
    } else {
      const seed = getDeterministicSeedFromPageData(variedPageData);
      const mixed = mixSeed(seed, variationSeed);
      code = generateCodeFromPreset(presetKey, mixed);
      console.log("[PageSynth Preset] selected:", presetKey);
      console.log("[PageSynth Preset] variation:", { variationSeed });
    }
    elements.liveCodeEditor.value = code;
    await chrome.storage.local.set({ [LIVE_CODE_STORAGE_KEY]: code });
    updateFormulaSummaryFromCode(code);

    showStatus("Applying Live Code...", "info");
    await applyLiveCode(code);

    showStatus("Starting music...", "info");
    const result = await startMusicFromCurrentPageData();
    await syncPlaybackState();

    if (result?.ok) {
      showStatus("🎵 Playing music", "success");
    } else {
      throw new Error(result?.message || "Start failed");
    }
  } catch (error) {
    const msg = String(error?.message || error || "unknown error");
    if (msg.includes("Cannot access") || msg.includes("chrome://") || msg.includes("extensions::")) {
      showStatus("Cannot analyze this page. Please try a standard web page.", "error");
    } else {
      showStatus(`❌ ${msg}`, "error");
    }
  } finally {
    setOneClickRunning(false);
  }
});

// ============================================
// 初始化
// ============================================
showStatus("Click Analyze Page to get started", "info");

// popup 開啟時同步播放狀態
async function syncPlaybackState(tag = "") {
  const syncReqId = ++playbackUiRequestId;
  console.log("[PageSynth Popup] syncing playback state", tag);

  // Don't let stale sync override recent start
  const recentlyStarted = Date.now() - lastStartAt < 2500;
  if ((localPlaybackState === "starting" || localPlaybackState === "playing") && recentlyStarted) {
    applyPlaybackUiState("sync-guarded");
    return { ok: true, isPlaying: true, isStopping: false };
  }
  try {
    const response = await sendMessageSafe({ action: "GET_PLAYBACK_STATE" }, 2000);
    console.log("[PageSynth Popup] playback state response", response);
    if (!response.ok) {
      if (syncReqId !== playbackUiRequestId) return { ok: false, reason: "stale request" };
      localPlaybackState = "stopped"; applyPlaybackUiState("sync-fail");
      return { ok: false, reason: response.error || "sync failed" };
    }

    const state = response.playbackState || response || {};
    const playing = Boolean(state.isPlaying ?? response?.isPlaying ?? false);
    const stopping = Boolean(state.isStopping ?? response?.isStopping ?? false);
    console.log("[PageSynth Popup] syncPlaybackState:", { isPlaying: playing, isStopping: stopping });

    if (playing || stopping) {
      if (syncReqId !== playbackUiRequestId) return { ok: false, reason: "stale request" };
      // don't override if user already stopped
      if (localPlaybackState === "stopping" || localPlaybackState === "stopped") {
        console.log("[PageSynth Popup] ignore sync playing after user stop");
        return { ok: true, isPlaying: playing, isStopping: stopping };
      }
      localPlaybackState = "playing";
      applyPlaybackUiState("sync-playing");
      showStatus("🎵 Playing music", "success");
    } else {
      if (syncReqId !== playbackUiRequestId) return { ok: false, reason: "stale request" };
      if (localPlaybackState !== "starting" && localPlaybackState !== "playing") {
        localPlaybackState = "stopped";
      }
      applyPlaybackUiState("sync-stopped");
    }
    return { ok: true, isPlaying: playing, isStopping: stopping };
  } catch (error) {
    console.log("[PageSynth Popup] sync timeout or failed", error);
    if (syncReqId !== playbackUiRequestId) return { ok: false, reason: "stale request" };
    if (localPlaybackState !== "starting" && localPlaybackState !== "playing") { localPlaybackState = "stopped"; } applyPlaybackUiState("sync-timeout");
    return { ok: false, reason: String(error.message || error) };
  }
}

// popup 開啟時同步播放狀態
(async () => {
  await syncPlaybackState();
})();

(async function initLiveCodeEditor() {
  try {
    // restore saved preset
    let savedPreset = "auto";
    try {
      const p = await chrome.storage.local.get([PRESET_STORAGE_KEY]);
      if (p?.[PRESET_STORAGE_KEY] && PAGE_SYNTH_PRESETS[p[PRESET_STORAGE_KEY]] !== undefined) {
        savedPreset = p[PRESET_STORAGE_KEY];
      }
    } catch (_) {}
    if (elements.presetSelect) {
      elements.presetSelect.value = savedPreset;
      updatePresetDescription(savedPreset);
    }

    const data = await chrome.storage.local.get([LIVE_CODE_STORAGE_KEY, MODE_STORAGE_KEY]);
    const code = data?.[LIVE_CODE_STORAGE_KEY] || DEFAULT_LIVE_CODE;
    elements.liveCodeEditor.value = code;

    const hasSavedLiveCode = Boolean(data?.[LIVE_CODE_STORAGE_KEY]);
    const savedMode = data?.[MODE_STORAGE_KEY];
    if (savedMode === MODE_PAGE_DATA || savedMode === MODE_HYBRID) {
      currentMode = savedMode;
    } else {
      currentMode = hasSavedLiveCode ? MODE_HYBRID : MODE_PAGE_DATA;
      await chrome.storage.local.set({ [MODE_STORAGE_KEY]: currentMode });
    }
    if (elements.modeSelect) {
      elements.modeSelect.value = currentMode;
    }

    const parsed = parseLiveCode(code);
    await sendMessageSafe({ action: "SET_LIVE_CODE_CONFIG", config: parsed });

    // restore button states after init
    localPlaybackState = "stopped"; applyPlaybackUiState("init");
  } catch (error) {
    elements.liveCodeEditor.value = DEFAULT_LIVE_CODE;
    currentMode = MODE_HYBRID;
    if (elements.modeSelect) {
      elements.modeSelect.value = currentMode;
    }
    console.warn("Live code init failed:", error);
  }
})();
