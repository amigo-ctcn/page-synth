/**
 * offscreen.js - PageSynth Web Audio 音樂引擎
 *
 * 16-step sequencer 搭配 4 層聲音：
 *   kick  - 低頻短促鼓聲
 *   hat   - 短促高頻噪音
 *   bass  - 低音旋律（minor pentatonic）
 *   blip  - 短促高音旋律（minor pentatonic）
 *
 * 資料映射：
 *   wordCount  → BPM (70~150)
 *   domCount   → 節奏密度（step 被觸發的機率）
 *   linkCount  → 音高偏移（半音）
 *   imageCount → filter cutoff
 *   title/bodyText → pentatonic melody 產生
 */

// ============================================
// Web Audio 相關變數
// ============================================
let audioContext = null;
let isPlaying = false;

// 排程相關
let scheduleInterval = null;
let nextStepTime = 0;
let currentStep = 0;
let barIndex = 0;
let scheduledTimeoutIds = [];
let activeNodes = new Set();

// 音樂參數
let musicParams = {
  bpm: 120,
  density: 0.5,
  pitchOffset: 0,
  filterCutoff: 1000
};

// 16-step sequencer 資料
let stepData = {
  kick: [],    // boolean[16]
  hat: [],     // boolean[16]
  snare: [],
  clap: [],
  bass: [],    // MIDI pitch[16] 或 null
  blip: [],    // MIDI pitch[16] 或 null
  padChords: []
};

// 旋律資料（由網頁文字產生）
let melodyNotes = [];       // MIDI pitch array
let melodyIndex = 0;
let rngSeed = 1;
let currentLiveCodeConfig = null;
let currentMode = "data-driven";
let hybridState = {
  enabled: false,
  pageBpmOffset: 0,
  hatMutationRate: 0,
  pitchOffset: 0,
  cutoff: 1200,
  seed: 1,
  bassDebugCounter: 0,
  swing: 0,
  blipRotate: 0,
  bassRotate: 0,
  mutationScale: 0,
  padBrightness: 1,
  padLengthMul: 1,
  padGainMul: 1,
  selectedPhraseByStyle: {},
  selectedGeneratedGrooveByStyle: {}
};

const MIX = {
  master: 0.72,
  kickSample: 0.76,
  hatSample: 0.21,
  snareSample: 0.42,
  clapSample: 0.36,
  kick: 0.9,
  hat: 0.24,
  bass: 0.39,
  blip: 0.32,
  pad: 0.28,
  reverbSend: 0.1,
  delaySend: 0.12,
  padReverbSend: 0.18
};

const SOUND_STYLE = "sample_warm";
const SAMPLE_PATHS = {
  kick: "assets/samples/kick.wav",
  hat: "assets/samples/hat.wav",
  openHat: "assets/samples/openhat.wav",
  snare: "assets/samples/snare.wav",
  clap: "assets/samples/clap.wav"
};

const INSTRUMENT_SAMPLE_PATHS = {
  bass: {
    baseNote: "A2",
    path: "assets/samples/instruments/bass_A2.wav"
  },
  pluck: {
    baseNote: "C4",
    path: "assets/samples/instruments/pluck_C4.wav"
  },
  pad: {
    baseNote: "C3",
    path: "assets/samples/instruments/pad_C3.wav"
  },
  softPiano: {
    baseNote: "C4",
    path: "assets/samples/instruments/soft_piano_C4.wav"
  },
  guitarPluck: {
    baseNote: "C4",
    path: "assets/samples/instruments/guitar_pluck_C4.wav"
  },
  nylonGuitar: {
    baseNote: "C4",
    path: "assets/samples/instruments/nylon_guitar_C4.wav"
  },
  nylonGuitarC3: {
    baseNote: "C3",
    path: "assets/samples/instruments/nylon_guitar_C3.wav"
  },
  acousticGuitarC3: {
    baseNote: "C3",
    path: "assets/samples/instruments/acoustic_guitar_C3.wav"
  },
  steelGuitarC4: {
    baseNote: "C4",
    path: "assets/samples/instruments/steel_guitar_C4.wav"
  },
  nylonGuitarC4Alt: {
    baseNote: "C4",
    path: "assets/samples/instruments/nylon_guitar_C4_alt.wav"
  },
  casioPianoC4: {
    baseNote: "C4",
    path: "assets/samples/instruments/Casio-Piano-C4.wav"
  },
  kawaiBassC2: {
    baseNote: "C2",
    path: "assets/samples/instruments/Kawai-Bass1-C2.wav"
  },
  kawaiAcousticBassC2: {
    baseNote: "C2",
    path: "assets/samples/instruments/Kawai-K1r-Acoustic-Bass-C2.wav"
  },
  bowedBassC2: {
    baseNote: "C2",
    path: "assets/samples/instruments/Bowed-Bass-C2.wav"
  },
  musicBoxC6: {
    baseNote: "C6",
    path: "assets/samples/instruments/Alesis-Music-Box-C6.wav"
  }
};

let audioGraph = null;
let sampleBuffers = new Map();
let drumSamplesLoadPromise = null;
let drumSamplesLoadSessionId = null;
let instrumentSampleBuffers = new Map();
let instrumentSamplesLoadPromise = null;
let instrumentSamplesLoadSessionId = null;
let audioSessionId = 0;
let loggedSampledBass = false;
let loggedSampledPluck = false;
let padArpSampleLogSet = new Set();
let padArpFallbackLogSet = new Set();
let padArpMultiSampleEnabledLogged = false;
let loggedBassSoftCut = false;
let loggedKawaiAcousticBass = false;
let loggedManualEmptyKick = false;
let loggedManualEmptyHat = false;
let loggedManualEmptyDrums = false;
let optionalSampleMissingLogSet = new Set();
let activeStylePreset = null;

const OPTIONAL_INSTRUMENT_SAMPLES = new Set([
  "nylonGuitarC4Alt",
  "steelGuitarC4",
  "acousticGuitarC3",
  "nylonGuitarC3",
  "guitarPluck",
  "softPiano",
  "casioPianoC4",
  "kawaiBassC2",
  "kawaiAcousticBassC2",
  "bowedBassC2",
  "musicBoxC6"
]);

const STYLE_PRESETS = {
  simple: { master: 0.66, kick: 0.11, hat: 0.08, bass: 0.16, blip: 0.12, pad: 0.64, saturation: 0.00, cutoffBias: 0.82, reverb: 0.30, delay: 0.12, mutation: 0.00, swing: 0.015 },
  warm: { master: 0.68, kick: 0.23, hat: 0.14, bass: 0.20, blip: 0.18, pad: 0.60, saturation: 0.04, cutoffBias: 0.85, reverb: 0.28, delay: 0.12, mutation: 0.02, swing: 0.02 },
  folk: { master: 0.68, kick: 0.26, hat: 0.17, bass: 0.24, blip: 0.00, pad: 0.64, saturation: 0.00, cutoffBias: 0.85, reverb: 0.30, delay: 0.14, mutation: 0.00, swing: 0.022 },
  pianoPop: { master: 0.70, kick: 0.24, hat: 0.12, bass: 0.23, blip: 0.00, pad: 0.76, saturation: 0.00, cutoffBias: 0.96, reverb: 0.37, delay: 0.14, mutation: 0.00, swing: 0.018 },
  calm: { master: 0.66, kick: 0.14, hat: 0.10, bass: 0.16, blip: 0.14, pad: 0.70, saturation: 0.00, cutoffBias: 0.75, reverb: 0.34, delay: 0.16, mutation: 0.00, swing: 0.015 },
  bright: { master: 0.68, kick: 0.25, hat: 0.16, bass: 0.18, blip: 0.12, pad: 0.52, saturation: 0.02, cutoffBias: 0.92, reverb: 0.24, delay: 0.12, mutation: 0.02, swing: 0.02 },
  tech: { master: 0.68, kick: 0.50, hat: 0.16, bass: 0.30, blip: 0.32, pad: 0.30, saturation: 0.12, cutoffBias: 1.00, reverb: 0.14, delay: 0.16, mutation: 0.10, swing: 0.01 },
  ambient: { master: 0.64, kick: 0.08, hat: 0.02, bass: 0.14, blip: 0.12, pad: 0.78, saturation: 0.00, cutoffBias: 0.65, reverb: 0.42, delay: 0.20, mutation: 0.00, swing: 0.00 },
  industrial: { master: 0.72, kick: 0.82, hat: 0.26, bass: 0.46, blip: 0.28, pad: 0.20, saturation: 0.50, cutoffBias: 1.05, reverb: 0.10, delay: 0.08, mutation: 0.24, swing: 0.00 }
};

const ARRANGEMENT_PRESETS = {
  simple: { kickPattern: "x-------x-------", hatPattern: "----------------", bassRhythm: [0, 8], blipRhythm: [4, 10, 14], padMode: "long", density: 0.25 },
  warm: { kickPattern: "x-------x-------", hatPattern: "----x-------x---", bassRhythm: [0, 8], blipRhythm: [6, 14], padMode: "long", density: 0.35 },
  folk: { kickPattern: "x-------x-------", hatPattern: "----x-------x---", bassRhythm: [0, 4, 8], blipRhythm: [6, 14], padMode: "long", density: 0.40 },
  pianoPop: { kickPattern: "x-------x-------", hatPattern: "----x-------x---", bassRhythm: [0, 4, 8], blipRhythm: [6, 14], padMode: "long", density: 0.45 },
  calm: { kickPattern: "x---------------", hatPattern: "--------x-------", bassRhythm: [0], blipRhythm: [10], padMode: "long", density: 0.22 },
  bright: { kickPattern: "x---x-------x---", hatPattern: "--x---x---x---x-", bassRhythm: [0, 4, 8, 12], blipRhythm: [2, 6, 10, 14], padMode: "short", density: 0.55 },
  tech: { kickPattern: "x---x---x---x---", hatPattern: "x-x-x-x-x-x-x-x-", bassRhythm: [0, 3, 8, 11], blipRhythm: [1, 5, 9, 13], padMode: "pulse", density: 0.65 },
  ambient: { kickPattern: "----------------", hatPattern: "----------------", bassRhythm: [0], blipRhythm: [12], padMode: "drone", density: 0.15 },
  industrial: { kickPattern: "x---x---x---x---", hatPattern: "x-x-x-x-x-x-x-x-", bassRhythm: [0, 4, 8, 12], blipRhythm: [2, 6, 10, 14], padMode: "short", density: 0.75 }
};

const MOTIF_LIBRARY = [
  { id: "simple_phrase_01", styles: ["simple"], bars: 1, rhythm: [0, 6, 12], contour: [0, 1, 0], density: 0.24 },
  { id: "simple_answer_01", styles: ["simple"], bars: 1, rhythm: [2, 8, 14], contour: [0, 2, 0], density: 0.26 },
  { id: "simple_falling_01", styles: ["simple"], bars: 1, rhythm: [0, 5, 11], contour: [2, 1, 0], density: 0.22 },
  { id: "warm_simple_01", styles: ["warm","folk"], bars: 1, rhythm: [0, 3, 6, 10, 14], contour: [0, 1, 2, 1, 0], density: 0.35 },
  { id: "warm_falling_01", styles: ["warm","folk"], bars: 1, rhythm: [1, 5, 9, 13], contour: [2, 1, 0, -1], density: 0.3 },
  { id: "calm_sparse_01", styles: ["calm"], bars: 1, rhythm: [2, 10], contour: [0, 1], density: 0.22 },
  { id: "calm_question_01", styles: ["calm"], bars: 1, rhythm: [4, 11, 15], contour: [0, 1, 0], density: 0.24 },
  { id: "bright_up_01", styles: ["bright"], bars: 1, rhythm: [0, 2, 6, 10, 14], contour: [0, 1, 2, 1, 3], density: 0.58 },
  { id: "bright_bounce_01", styles: ["bright"], bars: 1, rhythm: [1, 4, 7, 11, 15], contour: [1, 0, 2, 1, 0], density: 0.56 },
  { id: "bright_answer_01", styles: ["bright"], bars: 1, rhythm: [3, 6, 9, 13], contour: [0, 2, 1, 0], density: 0.54 },
  { id: "tech_pulse_01", styles: ["tech"], bars: 1, rhythm: [0, 3, 5, 8, 11, 13], contour: [0, 1, 0, 2, 1, 0], density: 0.66 },
  { id: "tech_sync_01", styles: ["tech"], bars: 1, rhythm: [1, 4, 6, 9, 12, 14], contour: [1, 2, 1, 0, 2, 1], density: 0.64 },
  { id: "tech_short_01", styles: ["tech"], bars: 1, rhythm: [2, 5, 10, 13], contour: [0, 2, 1, 0], density: 0.62 },
  { id: "ambient_slow_01", styles: ["ambient"], bars: 1, rhythm: [4, 12], contour: [0, 1], density: 0.14 },
  { id: "ambient_space_01", styles: ["ambient"], bars: 1, rhythm: [2, 14], contour: [0, -1], density: 0.12 },
  { id: "ambient_echo_01", styles: ["ambient"], bars: 1, rhythm: [0, 8, 15], contour: [0, 1, 0], density: 0.16 },
  { id: "industrial_stab_01", styles: ["industrial"], bars: 1, rhythm: [0, 2, 6, 8, 10, 14], contour: [0, 2, 1, 0, 2, 1], density: 0.78 },
  { id: "industrial_repeat_01", styles: ["industrial"], bars: 1, rhythm: [1, 5, 9, 13], contour: [0, 0, 1, 0], density: 0.74 },
  { id: "industrial_dark_01", styles: ["industrial"], bars: 1, rhythm: [3, 7, 11, 15], contour: [-1, 0, 1, 0], density: 0.72 },
  { id: "default_balanced_01", styles: ["default"], bars: 1, rhythm: [0, 4, 9, 13], contour: [0, 1, 2, 0], density: 0.45 },
  { id: "default_soft_01", styles: ["default"], bars: 1, rhythm: [2, 6, 10, 14], contour: [0, 1, 1, 0], density: 0.4 }
];

const ARPEGGIO_PATTERNS = {
  simple: [[0, 1, 2, 1], [0, 1, 0, 2], [0, 2, 1, 0]],
  calm: [[0, 1, 2, 1], [0, 1, 0, 2], [1, 2, 1, 0]],
  warm: [[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 1, 2]],
  folk: [[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 1, 2], [0, 1, 2, 3]],
  pianoPop: [[0, 1, 2, 3], [0, 2, 3, 2], [0, 1, 2, 3], [0, 2, 1, 2]],
  bright: [[0, 1, 2, 3], [0, 2, 3, 2], [1, 2, 3, 1]],
  tech: [[0, 2, 1, 2], [0, 2, 0, 1], [2, 1, 2, 0]],
  ambient: [[0, 1, 2], [0, 2, 1], [1, 2, 0]],
  industrial: [[0, 0, 2, 0], [0, 2, 0, 2], [2, 0, 1, 0]],
  default: [[0, 1, 2, 1], [0, 2, 1, 0]]
};

// ── PianoPop Formula Playback v1.5 ──

function getPianoPopVariant() {
  const config = currentLiveCodeConfig;
  if (!config) return "flow";
  const style = (config.style || config._style || "").toLowerCase();
  if (style !== "pianopop") return "flow";
  const hat = (config.hat || config._hat || "");
  const bpm = Number(config.bpm || config._bpm || 96);
  if (hat === "----------------") return "soft";
  if (hat === "xx-x-x-xxx-x-x-x" || hat.includes("xx-x-x-xxx")) return "motion";
  if (bpm <= 94) return "story";
  if (hat === "x---x-x-x---x-x-" || hat.includes("x---x-x-x")) return "story";
  return "flow";
}

function getPianoPopSectionFormula(variant, section, seed) {
  const pickOne = (arr) => arr[Math.abs(seed) % arr.length];

  const map = {
    flow: {
      intro:     { arp:"soft_sparse", bass:"off",         hh:"off" },
      main:      { arp:"flow_basic",  bass:"root_pulse",  hh:"flow" },
      variation: { arp:["ballad_rolling","broken_up"], bass:"root_pulse", hh:["flow","motion"] },
      break:     { arp:"soft_sparse", bass:"off",         hh:"off" },
      return:    { arp:"flow_basic",  bass:"root_pulse",  hh:"flow" }
    },
    soft: {
      intro:     { arp:"soft_sparse", bass:"off",         hh:"off" },
      main:      { arp:["soft_sparse","question_answer"], bass:["sparse_root","root_pulse"], hh:"off" },
      variation: { arp:"question_answer", bass:"sparse_root",              hh:"off" },
      break:     { arp:"soft_sparse",       bass:"off",                   hh:"off" },
      return:    { arp:"soft_sparse",       bass:"sparse_root",           hh:"off" }
    },
    story: {
      intro:     { arp:"soft_sparse",    bass:"off",         hh:"off" },
      main:      { arp:"ballad_rolling", bass:"root_pulse",  hh:"story" },
      variation: { arp:"question_answer", bass:["sparse_root","root_pulse"], hh:["story","flow"] },
      break:     { arp:"soft_sparse",     bass:"off",                      hh:"off" },
      return:    { arp:"ballad_rolling",  bass:"root_pulse",               hh:"story" }
    },
    motion: {
      intro:     { arp:["flow_basic","soft_sparse"], bass:"sparse_root", hh:"off" },
      main:      { arp:"broken_up",                   bass:"root_pulse",  hh:["motion","flow"] },
      variation: { arp:["broken_up","flow_basic"],    bass:["root_pulse","four_pulse"], hh:"motion" },
      break:     { arp:"soft_sparse",                 bass:"off",         hh:"off" },
      return:    { arp:"broken_up",                   bass:"root_pulse",  hh:"motion" }
    }
  };

  const group = (map[variant] || map.flow)[section] || map.flow.main;
  const arp = Array.isArray(group.arp) ? pickOne(group.arp) : group.arp;
  const bass = Array.isArray(group.bass) ? pickOne(group.bass) : group.bass;
  const hh = Array.isArray(group.hh) ? pickOne(group.hh) : group.hh;

  return {
    arpFormulaKey: arp,
    bassFormulaKey: bass,
    hhFormulaKey: hh,
    arpFormula: PIANO_ARP_FORMULAS[arp] || null,
    bassFormula: BASS_FORMULAS[bass] || null,
    hhFormula: HH_FORMULAS[hh] || null
  };
}

let formulaPlaybackLogged = false;
let formulaPlaybackSection = null;

// ── Musical Formula Library v1.4A ──

const PIANO_ARP_FORMULAS = {
  flow_basic: {
    name: "Flow Basic", bars: 4,
    patterns: [
      { bar: 0, roles: ["root","fifth","third","fifth","octaveRoot","fifth","third","fifth"], offsets: [0,2,4,6,8,10,12,14] },
      { bar: 1, roles: ["root","fifth","third","fifth","root","fifth","third"],          offsets: [0,2,4,6,8,10,14] },
      { bar: 2, roles: ["root","fifth","third","fifth","root","fifth","third","fifth","root"], offsets: [0,2,4,6,8,9,10,12,14] },
      { bar: 3, roles: ["root","fifth","third","fifth","root","fifth"],                   offsets: [0,2,4,6,10,14] }
    ]
  },
  ballad_rolling: {
    name: "Ballad Rolling", bars: 4,
    patterns: [
      { bar: 0, roles: ["root","fifth","octaveRoot","fifth","third","fifth","octaveRoot","fifth"], offsets: [0,2,4,6,8,10,12,14] },
      { bar: 1, roles: ["root","fifth","octaveRoot","fifth","third","fifth","octaveRoot","fifth"], offsets: [0,2,4,6,8,10,12,14] },
      { bar: 2, roles: ["root","fifth","octaveRoot","fifth","third","fifth","octaveRoot","fifth"], offsets: [0,2,4,6,8,10,12,14] },
      { bar: 3, roles: ["root","fifth","octaveRoot","fifth"],                                offsets: [0,3,7,14] }
    ]
  },
  broken_up: {
    name: "Broken Up", bars: 4,
    patterns: [
      { bar: 0, roles: ["root","third","fifth","octaveRoot","root","third","fifth","octaveRoot"], offsets: [0,2,4,6,8,10,12,14] },
      { bar: 1, roles: ["root","third","fifth","octaveRoot","root","third","fifth","octaveRoot"], offsets: [0,2,4,6,8,10,12,14] },
      { bar: 2, roles: ["root","third","fifth","octaveRoot","root","third","fifth"],             offsets: [0,2,4,6,8,10,14] },
      { bar: 3, roles: ["root","fifth","octaveRoot"],                                            offsets: [0,6,14] }
    ]
  },
  question_answer: {
    name: "Question Answer", bars: 4,
    patterns: [
      { bar: 0, roles: ["root","fifth","root"],                    offsets: [0,4,12] },
      { bar: 1, roles: ["root","fifth","third","fifth","root"],    offsets: [0,2,4,8,14] },
      { bar: 2, roles: ["root","fifth","third","fifth","octaveRoot","fifth","third"], offsets: [0,2,4,6,8,10,14] },
      { bar: 3, roles: ["root","fifth","root"],                    offsets: [0,6,14] }
    ]
  },
  soft_sparse: {
    name: "Soft Sparse", bars: 4,
    patterns: [
      { bar: 0, roles: ["root","fifth","root"],        offsets: [0,4,12] },
      { bar: 1, roles: ["root","fifth","root"],        offsets: [0,4,12] },
      { bar: 2, roles: ["root","fifth","root"],        offsets: [0,6,14] },
      { bar: 3, roles: ["root","fifth","root"],        offsets: [0,6,14] }
    ]
  }
};

const BASS_FORMULAS = {
  root_pulse:   { name: "Root Pulse",   steps: [0,4,12], velocityMul: 1.0,  role: "root" },
  simple_root:  { name: "Simple Root",  steps: [0,8],    velocityMul: 1.0,  role: "root" },
  sparse_root:  { name: "Sparse Root",  steps: [0],      velocityMul: 1.0,  role: "root" },
  four_pulse:   { name: "Four Pulse",   steps: [0,4,8,12], velocityMul: 0.7, role: "root" }
};

const HH_FORMULAS = {
  off:        { name: "Off",        steps: [],                                    pattern: "----------------", closedOnly: true },
  soft_pulse: { name: "Soft Pulse", steps: [0,4,8,12],                           pattern: "x---x---x---x---", closedOnly: true },
  flow:       { name: "Flow",       steps: [0,1,3,5,7,8,9,11,13,15],            pattern: "xx-x-x-xxx-x-x-x", closedOnly: true },
  story:      { name: "Story",      steps: [0,4,6,8,12,14],                      pattern: "x---x-x-x---x-x-", closedOnly: true },
  motion:     { name: "Motion",     steps: [0,1,4,5,8,9,10,11,12,13,14,15],     pattern: "xx-xx-xxxx-xx-xx", closedOnly: true }
};

const SECTION_FORMULAS = {
  intro:      { arp: "soft_sparse", bass: "off",    hh: "off" },
  main:       { arp: "flow_basic",  bass: "root_pulse", hh: "flow" },
  variation:  { arp: ["ballad_rolling","broken_up"], bass: "root_pulse", hh: ["flow","motion"] },
  breakSec:   { arp: "soft_sparse", bass: "off",    hh: "off" },
  returnSec:  { arp: "flow_basic",  bass: "root_pulse", hh: "flow" }
};

let formulaDebugLogged = false;

const GROOVE_LIBRARY = [
  { id: "simple_folk_01", styles: ["simple"], bars: 2, kick: [{ step: 0, velocity: 0.46 }, { step: 16, velocity: 0.44 }], hat: [{ step: 12, velocity: 0.06 }], snare: [], clap: [], swing: 0.015, bassRhythm: [{ step: 0, velocity: 0.54 }, { step: 16, velocity: 0.5 }], blipRhythm: [{ step: 4, velocity: 0.3 }, { step: 10, velocity: 0.28 }, { step: 20, velocity: 0.3 }, { step: 28, velocity: 0.26 }] },
  { id: "simple_pop_01", styles: ["simple"], bars: 2, kick: [{ step: 0, velocity: 0.5 }, { step: 8, velocity: 0.34 }, { step: 16, velocity: 0.48 }], hat: [{ step: 14, velocity: 0.06 }, { step: 30, velocity: 0.06 }], snare: [], clap: [], swing: 0.014, bassRhythm: [{ step: 0, velocity: 0.52 }, { step: 8, velocity: 0.36 }, { step: 16, velocity: 0.5 }], blipRhythm: [{ step: 4, velocity: 0.3 }, { step: 12, velocity: 0.28 }, { step: 22, velocity: 0.3 }, { step: 30, velocity: 0.26 }] },
  { id: "simple_soft_01", styles: ["simple"], bars: 2, kick: [{ step: 0, velocity: 0.44 }, { step: 20, velocity: 0.3 }], hat: [], snare: [], clap: [], swing: 0.016, bassRhythm: [{ step: 0, velocity: 0.52 }, { step: 20, velocity: 0.36 }], blipRhythm: [{ step: 6, velocity: 0.28 }, { step: 14, velocity: 0.26 }, { step: 26, velocity: 0.26 }] },
  { id: "simple_reggae_01", styles: ["simple","warm","folk"], bars: 2, kick: [{ step: 0, velocity: 0.46 }, { step: 18, velocity: 0.34 }], hat: [{ step: 2, velocity: 0.2, type: "openHat", durationSteps: 2 }, { step: 6, velocity: 0.18, type: "openHat", durationSteps: 2 }, { step: 10, velocity: 0.2, type: "openHat", durationSteps: 2 }, { step: 14, velocity: 0.18, type: "openHat", durationSteps: 2 }, { step: 18, velocity: 0.2, type: "openHat", durationSteps: 2 }, { step: 22, velocity: 0.18, type: "openHat", durationSteps: 2 }, { step: 26, velocity: 0.2, type: "openHat", durationSteps: 2 }, { step: 30, velocity: 0.18, type: "openHat", durationSteps: 2 }], snare: [], clap: [], swing: 0.02, bassRhythm: [{ step: 0, velocity: 0.5 }, { step: 16, velocity: 0.46 }], blipRhythm: [{ step: 4, velocity: 0.26 }, { step: 20, velocity: 0.24 }] },
  { id: "house_soft_01", styles: ["bright","tech"], bars: 2, kick: [{ step: 0, velocity: 0.52 }, { step: 4, velocity: 0.46 }, { step: 8, velocity: 0.5 }, { step: 12, velocity: 0.44 }, { step: 16, velocity: 0.52 }, { step: 20, velocity: 0.46 }, { step: 24, velocity: 0.5 }, { step: 28, velocity: 0.44 }], hat: [{ step: 2, velocity: 0.42, type: "openHat", durationSteps: 2 }, { step: 6, velocity: 0.4, type: "openHat", durationSteps: 2 }, { step: 10, velocity: 0.42, type: "openHat", durationSteps: 2 }, { step: 14, velocity: 0.4, type: "openHat", durationSteps: 2 }, { step: 18, velocity: 0.42, type: "openHat", durationSteps: 2 }, { step: 22, velocity: 0.4, type: "openHat", durationSteps: 2 }, { step: 26, velocity: 0.42, type: "openHat", durationSteps: 2 }, { step: 30, velocity: 0.4, type: "openHat", durationSteps: 2 }], snare: [], clap: [], swing: 0.012, bassRhythm: [{ step: 0, velocity: 0.48 }, { step: 8, velocity: 0.4 }, { step: 16, velocity: 0.46 }, { step: 24, velocity: 0.38 }], blipRhythm: [{ step: 2, velocity: 0.24 }, { step: 10, velocity: 0.22 }, { step: 18, velocity: 0.24 }, { step: 26, velocity: 0.22 }] },
  { id: "pop_sync_01", styles: ["simple","warm","folk","bright"], bars: 2, kick: [{ step: 0, velocity: 0.52 }, { step: 2, velocity: 0.44, accent: true, tieTo: 4 }, { step: 8, velocity: 0.46 }, { step: 16, velocity: 0.5 }, { step: 18, velocity: 0.44, accent: true, tieTo: 20 }, { step: 24, velocity: 0.44 }], hat: [{ step: 6, velocity: 0.2 }, { step: 14, velocity: 0.18 }, { step: 22, velocity: 0.2 }, { step: 30, velocity: 0.18 }], snare: [], clap: [], swing: 0.016, bassRhythm: [{ step: 0, velocity: 0.48, durationSteps: 2 }, { step: 2, velocity: 0.38, durationSteps: 2, tieTo: 4 }, { step: 16, velocity: 0.46, durationSteps: 2 }, { step: 18, velocity: 0.38, durationSteps: 2, tieTo: 20 }], blipRhythm: [{ step: 10, velocity: 0.2 }, { step: 26, velocity: 0.2 }] },
  { id: "warm_flow_01", styles: ["warm","folk"], bars: 2, kick: [{ step: 0, velocity: 0.62 }, { step: 10, velocity: 0.38 }, { step: 20, velocity: 0.55 }], hat: [{ step: 4, velocity: 0.14 }, { step: 12, velocity: 0.12 }, { step: 28, velocity: 0.1 }], snare: [], clap: [], swing: 0.02, bassRhythm: [{ step: 0, velocity: 0.62 }, { step: 9, velocity: 0.4 }, { step: 24, velocity: 0.5 }], blipRhythm: [{ step: 6, velocity: 0.42 }, { step: 14, velocity: 0.34 }, { step: 30, velocity: 0.3 }] },
  { id: "warm_pulse_01", styles: ["warm","folk"], bars: 2, kick: [{ step: 0, velocity: 0.64 }, { step: 8, velocity: 0.44 }, { step: 22, velocity: 0.35 }], hat: [{ step: 3, velocity: 0.13 }, { step: 11, velocity: 0.1 }, { step: 19, velocity: 0.12 }], snare: [], clap: [], swing: 0.018, bassRhythm: [{ step: 0, velocity: 0.58 }, { step: 8, velocity: 0.35 }, { step: 18, velocity: 0.4 }], blipRhythm: [{ step: 5, velocity: 0.4 }, { step: 13, velocity: 0.33 }, { step: 29, velocity: 0.28 }] },
  { id: "warm_soft_01", styles: ["warm","folk"], bars: 2, kick: [{ step: 0, velocity: 0.6 }, { step: 9, velocity: 0.3 }, { step: 25, velocity: 0.42 }], hat: [{ step: 7, velocity: 0.1 }, { step: 15, velocity: 0.1 }, { step: 23, velocity: 0.08 }], snare: [], clap: [], swing: 0.022, bassRhythm: [{ step: 0, velocity: 0.6 }, { step: 9, velocity: 0.32 }], blipRhythm: [{ step: 6, velocity: 0.38 }, { step: 22, velocity: 0.28 }] },
  { id: "calm_soft_01", styles: ["calm"], bars: 2, kick: [{ step: 0, velocity: 0.58 }, { step: 18, velocity: 0.33 }], hat: [{ step: 4, velocity: 0.12 }, { step: 20, velocity: 0.1 }], snare: [], clap: [], swing: 0.02, bassRhythm: [{ step: 0, velocity: 0.58 }, { step: 17, velocity: 0.34 }], blipRhythm: [{ step: 6, velocity: 0.32 }, { step: 30, velocity: 0.26 }] },
  { id: "calm_sparse_02", styles: ["calm"], bars: 2, kick: [{ step: 0, velocity: 0.55 }, { step: 24, velocity: 0.3 }], hat: [{ step: 8, velocity: 0.11 }, { step: 28, velocity: 0.09 }], snare: [], clap: [], swing: 0.018, bassRhythm: [{ step: 0, velocity: 0.56 }, { step: 23, velocity: 0.28 }], blipRhythm: [{ step: 10, velocity: 0.3 }, { step: 26, velocity: 0.24 }] },
  { id: "calm_air_01", styles: ["calm"], bars: 2, kick: [{ step: 0, velocity: 0.52 }, { step: 20, velocity: 0.28 }], hat: [{ step: 12, velocity: 0.09 }, { step: 29, velocity: 0.08 }], snare: [], clap: [], swing: 0.024, bassRhythm: [{ step: 0, velocity: 0.54 }, { step: 19, velocity: 0.3 }], blipRhythm: [{ step: 14, velocity: 0.28 }, { step: 31, velocity: 0.22 }] },
  { id: "bright_bounce_02", styles: ["bright"], bars: 2, kick: [{ step: 0, velocity: 0.78 }, { step: 7, velocity: 0.5 }, { step: 12, velocity: 0.68 }, { step: 23, velocity: 0.48 }], hat: [{ step: 2, velocity: 0.2 }, { step: 6, velocity: 0.16 }, { step: 10, velocity: 0.19 }, { step: 14, velocity: 0.17 }, { step: 18, velocity: 0.18 }, { step: 22, velocity: 0.16 }, { step: 26, velocity: 0.18 }, { step: 30, velocity: 0.16 }], snare: [], clap: [{ step: 8, velocity: 0.22 }, { step: 24, velocity: 0.24 }], swing: 0.016, bassRhythm: [{ step: 0, velocity: 0.72 }, { step: 8, velocity: 0.5 }, { step: 16, velocity: 0.66 }, { step: 24, velocity: 0.48 }], blipRhythm: [{ step: 3, velocity: 0.55 }, { step: 9, velocity: 0.48 }, { step: 13, velocity: 0.5 }, { step: 27, velocity: 0.44 }] },
  { id: "bright_pop_01", styles: ["bright"], bars: 2, kick: [{ step: 0, velocity: 0.74 }, { step: 8, velocity: 0.58 }, { step: 20, velocity: 0.46 }], hat: [{ step: 1, velocity: 0.18 }, { step: 5, velocity: 0.15 }, { step: 9, velocity: 0.17 }, { step: 13, velocity: 0.16 }, { step: 17, velocity: 0.16 }, { step: 21, velocity: 0.14 }, { step: 25, velocity: 0.16 }, { step: 29, velocity: 0.14 }], snare: [], clap: [{ step: 8, velocity: 0.2 }, { step: 24, velocity: 0.22 }], swing: 0.014, bassRhythm: [{ step: 0, velocity: 0.7 }, { step: 10, velocity: 0.44 }, { step: 24, velocity: 0.5 }], blipRhythm: [{ step: 2, velocity: 0.5 }, { step: 6, velocity: 0.46 }, { step: 14, velocity: 0.5 }, { step: 30, velocity: 0.42 }] },
  { id: "bright_answer_02", styles: ["bright"], bars: 2, kick: [{ step: 0, velocity: 0.76 }, { step: 11, velocity: 0.44 }, { step: 16, velocity: 0.7 }, { step: 27, velocity: 0.42 }], hat: [{ step: 2, velocity: 0.18 }, { step: 4, velocity: 0.12 }, { step: 10, velocity: 0.18 }, { step: 12, velocity: 0.12 }, { step: 18, velocity: 0.17 }, { step: 26, velocity: 0.16 }], snare: [], clap: [{ step: 24, velocity: 0.22 }], swing: 0.015, bassRhythm: [{ step: 0, velocity: 0.72 }, { step: 12, velocity: 0.42 }, { step: 16, velocity: 0.64 }], blipRhythm: [{ step: 5, velocity: 0.48 }, { step: 9, velocity: 0.44 }, { step: 21, velocity: 0.46 }, { step: 29, velocity: 0.4 }] },
  { id: "tech_sync_02", styles: ["tech"], bars: 2, kick: [{ step: 0, velocity: 0.82 }, { step: 6, velocity: 0.52 }, { step: 10, velocity: 0.66 }, { step: 16, velocity: 0.8 }, { step: 22, velocity: 0.5 }, { step: 28, velocity: 0.64 }], hat: [{ step: 1, velocity: 0.2 }, { step: 3, velocity: 0.16 }, { step: 5, velocity: 0.2 }, { step: 9, velocity: 0.18 }, { step: 13, velocity: 0.18 }, { step: 17, velocity: 0.2 }, { step: 21, velocity: 0.17 }, { step: 25, velocity: 0.18 }, { step: 29, velocity: 0.17 }], snare: [{ step: 12, velocity: 0.2 }, { step: 28, velocity: 0.2 }], clap: [], swing: 0.012, bassRhythm: [{ step: 0, velocity: 0.78 }, { step: 6, velocity: 0.46 }, { step: 16, velocity: 0.74 }, { step: 22, velocity: 0.44 }], blipRhythm: [{ step: 4, velocity: 0.52 }, { step: 8, velocity: 0.46 }, { step: 12, velocity: 0.5 }, { step: 20, velocity: 0.46 }, { step: 30, velocity: 0.44 }] },
  { id: "tech_pulse_02", styles: ["tech"], bars: 2, kick: [{ step: 0, velocity: 0.8 }, { step: 8, velocity: 0.6 }, { step: 14, velocity: 0.46 }, { step: 24, velocity: 0.58 }], hat: [{ step: 2, velocity: 0.18 }, { step: 6, velocity: 0.16 }, { step: 10, velocity: 0.18 }, { step: 18, velocity: 0.17 }, { step: 22, velocity: 0.16 }, { step: 26, velocity: 0.16 }, { step: 30, velocity: 0.16 }], snare: [{ step: 12, velocity: 0.18 }], clap: [{ step: 28, velocity: 0.16 }], swing: 0.01, bassRhythm: [{ step: 0, velocity: 0.76 }, { step: 8, velocity: 0.48 }, { step: 23, velocity: 0.42 }], blipRhythm: [{ step: 3, velocity: 0.48 }, { step: 11, velocity: 0.44 }, { step: 19, velocity: 0.42 }, { step: 27, velocity: 0.42 }] },
  { id: "tech_short_02", styles: ["tech"], bars: 2, kick: [{ step: 0, velocity: 0.78 }, { step: 5, velocity: 0.44 }, { step: 11, velocity: 0.56 }, { step: 17, velocity: 0.72 }, { step: 27, velocity: 0.52 }], hat: [{ step: 1, velocity: 0.17 }, { step: 4, velocity: 0.15 }, { step: 7, velocity: 0.16 }, { step: 13, velocity: 0.16 }, { step: 19, velocity: 0.16 }, { step: 25, velocity: 0.16 }, { step: 31, velocity: 0.14 }], snare: [{ step: 24, velocity: 0.18 }], clap: [], swing: 0.012, bassRhythm: [{ step: 0, velocity: 0.74 }, { step: 11, velocity: 0.42 }, { step: 17, velocity: 0.66 }], blipRhythm: [{ step: 2, velocity: 0.46 }, { step: 9, velocity: 0.42 }, { step: 18, velocity: 0.44 }, { step: 30, velocity: 0.38 }] },
  { id: "ambient_space_02", styles: ["ambient"], bars: 2, kick: [{ step: 0, velocity: 0.38 }], hat: [{ step: 12, velocity: 0.08 }, { step: 30, velocity: 0.07 }], snare: [], clap: [], swing: 0.024, bassRhythm: [{ step: 0, velocity: 0.46 }, { step: 20, velocity: 0.3 }], blipRhythm: [{ step: 14, velocity: 0.24 }, { step: 31, velocity: 0.2 }] },
  { id: "ambient_slow_02", styles: ["ambient"], bars: 2, kick: [{ step: 0, velocity: 0.36 }, { step: 24, velocity: 0.24 }], hat: [{ step: 8, velocity: 0.07 }, { step: 28, velocity: 0.07 }], snare: [], clap: [], swing: 0.025, bassRhythm: [{ step: 0, velocity: 0.44 }, { step: 24, velocity: 0.26 }], blipRhythm: [{ step: 10, velocity: 0.22 }, { step: 26, velocity: 0.2 }] },
  { id: "ambient_echo_02", styles: ["ambient"], bars: 2, kick: [{ step: 0, velocity: 0.34 }], hat: [{ step: 15, velocity: 0.07 }, { step: 23, velocity: 0.07 }], snare: [], clap: [], swing: 0.026, bassRhythm: [{ step: 0, velocity: 0.42 }, { step: 16, velocity: 0.24 }], blipRhythm: [{ step: 8, velocity: 0.22 }, { step: 29, velocity: 0.18 }] },
  { id: "industrial_grid_01", styles: ["industrial"], bars: 2, kick: [{ step: 0, velocity: 0.9 }, { step: 4, velocity: 0.72 }, { step: 8, velocity: 0.84 }, { step: 12, velocity: 0.7 }, { step: 16, velocity: 0.88 }, { step: 20, velocity: 0.68 }, { step: 24, velocity: 0.82 }, { step: 28, velocity: 0.7 }], hat: [{ step: 1, velocity: 0.24 }, { step: 3, velocity: 0.2 }, { step: 5, velocity: 0.24 }, { step: 7, velocity: 0.2 }, { step: 9, velocity: 0.24 }, { step: 11, velocity: 0.2 }, { step: 13, velocity: 0.24 }, { step: 15, velocity: 0.2 }, { step: 17, velocity: 0.24 }, { step: 19, velocity: 0.2 }, { step: 21, velocity: 0.24 }, { step: 23, velocity: 0.2 }, { step: 25, velocity: 0.24 }, { step: 27, velocity: 0.2 }, { step: 29, velocity: 0.24 }, { step: 31, velocity: 0.2 }], snare: [{ step: 8, velocity: 0.26 }, { step: 24, velocity: 0.28 }], clap: [], swing: 0.004, bassRhythm: [{ step: 0, velocity: 0.84 }, { step: 8, velocity: 0.72 }, { step: 16, velocity: 0.8 }, { step: 24, velocity: 0.72 }], blipRhythm: [{ step: 2, velocity: 0.5 }, { step: 6, velocity: 0.46 }, { step: 10, velocity: 0.5 }, { step: 14, velocity: 0.46 }, { step: 18, velocity: 0.5 }, { step: 22, velocity: 0.46 }, { step: 26, velocity: 0.5 }, { step: 30, velocity: 0.46 }] },
  { id: "industrial_stab_02", styles: ["industrial"], bars: 2, kick: [{ step: 0, velocity: 0.88 }, { step: 6, velocity: 0.66 }, { step: 12, velocity: 0.8 }, { step: 16, velocity: 0.86 }, { step: 22, velocity: 0.64 }, { step: 28, velocity: 0.78 }], hat: [{ step: 2, velocity: 0.22 }, { step: 5, velocity: 0.2 }, { step: 9, velocity: 0.22 }, { step: 13, velocity: 0.2 }, { step: 18, velocity: 0.22 }, { step: 21, velocity: 0.2 }, { step: 25, velocity: 0.22 }, { step: 29, velocity: 0.2 }], snare: [{ step: 24, velocity: 0.24 }], clap: [{ step: 8, velocity: 0.18 }], swing: 0.004, bassRhythm: [{ step: 0, velocity: 0.82 }, { step: 12, velocity: 0.68 }, { step: 16, velocity: 0.76 }, { step: 28, velocity: 0.66 }], blipRhythm: [{ step: 3, velocity: 0.48 }, { step: 11, velocity: 0.44 }, { step: 19, velocity: 0.46 }, { step: 27, velocity: 0.44 }] },
  { id: "industrial_dark_02", styles: ["industrial"], bars: 2, kick: [{ step: 0, velocity: 0.86 }, { step: 8, velocity: 0.74 }, { step: 15, velocity: 0.6 }, { step: 16, velocity: 0.84 }, { step: 24, velocity: 0.72 }], hat: [{ step: 1, velocity: 0.2 }, { step: 4, velocity: 0.18 }, { step: 7, velocity: 0.2 }, { step: 10, velocity: 0.18 }, { step: 13, velocity: 0.2 }, { step: 17, velocity: 0.2 }, { step: 20, velocity: 0.18 }, { step: 23, velocity: 0.2 }, { step: 26, velocity: 0.18 }, { step: 29, velocity: 0.2 }], snare: [{ step: 24, velocity: 0.26 }], clap: [], swing: 0.003, bassRhythm: [{ step: 0, velocity: 0.8 }, { step: 15, velocity: 0.62 }, { step: 16, velocity: 0.78 }, { step: 24, velocity: 0.66 }], blipRhythm: [{ step: 5, velocity: 0.44 }, { step: 14, velocity: 0.42 }, { step: 21, velocity: 0.44 }, { step: 30, velocity: 0.4 }] }
];

const PHRASE_LIBRARY = [
  {
    id: "simple_folk_arp_01",
    styles: ["simple"],
    type: "arp",
    bars: 4,
    events: [
      { bar: 0, step: 0, role: "root", velocity: 0.84, durationSteps: 2 },
      { bar: 0, step: 2, role: "fifth", velocity: 0.62, durationSteps: 2 },
      { bar: 0, step: 4, role: "octaveRoot", velocity: 0.68, durationSteps: 2 },
      { bar: 0, step: 6, role: "fifth", velocity: 0.58, durationSteps: 2 },
      { bar: 0, step: 8, role: "root", velocity: 0.8, durationSteps: 2 },
      { bar: 0, step: 10, role: "fifth", velocity: 0.6, durationSteps: 2 },
      { bar: 0, step: 12, role: "octaveRoot", velocity: 0.66, durationSteps: 2 },
      { bar: 0, step: 14, role: "fifth", velocity: 0.56, durationSteps: 2 },
      { bar: 1, step: 0, role: "root", velocity: 0.82, durationSteps: 2 },
      { bar: 1, step: 2, role: "fifth", velocity: 0.58, durationSteps: 2 },
      { bar: 1, step: 6, role: "fifth", velocity: 0.54, durationSteps: 2 },
      { bar: 1, step: 8, role: "root", velocity: 0.78, durationSteps: 2 },
      { bar: 1, step: 12, role: "octaveRoot", velocity: 0.62, durationSteps: 2 },
      { bar: 1, step: 14, role: "fifth", velocity: 0.52, durationSteps: 2 },
      { bar: 2, step: 0, role: "root", velocity: 0.84, durationSteps: 2 },
      { bar: 2, step: 2, role: "fifth", velocity: 0.62, durationSteps: 2 },
      { bar: 2, step: 4, role: "octaveRoot", velocity: 0.7, durationSteps: 2 },
      { bar: 2, step: 8, role: "root", velocity: 0.78, durationSteps: 2 },
      { bar: 2, step: 9, role: "fifth", velocity: 0.58, durationSteps: 1 },
      { bar: 2, step: 12, role: "octaveRoot", velocity: 0.64, durationSteps: 2 },
      { bar: 2, step: 14, role: "fifth", velocity: 0.54, durationSteps: 2 },
      { bar: 3, step: 0, role: "root", velocity: 0.8, durationSteps: 2 },
      { bar: 3, step: 4, role: "fifth", velocity: 0.58, durationSteps: 2 },
      { bar: 3, step: 10, role: "octaveRoot", velocity: 0.56, durationSteps: 2 },
      { bar: 3, step: 14, role: "root", velocity: 0.52, durationSteps: 3 }
    ]
  },
  {
    id: "simple_folk_arp_02",
    styles: ["simple"],
    type: "arp",
    bars: 4,
    events: [
      { bar: 0, step: 0, role: "root", velocity: 0.85, durationSteps: 2 },
      { bar: 0, step: 3, role: "fifth", velocity: 0.6, durationSteps: 2 },
      { bar: 0, step: 6, role: "octaveRoot", velocity: 0.68, durationSteps: 2 },
      { bar: 0, step: 10, role: "fifth", velocity: 0.56, durationSteps: 2 },
      { bar: 0, step: 14, role: "root", velocity: 0.54, durationSteps: 2 },
      { bar: 1, step: 0, role: "root", velocity: 0.82, durationSteps: 2 },
      { bar: 1, step: 4, role: "fifth", velocity: 0.58, durationSteps: 2 },
      { bar: 1, step: 8, role: "root", velocity: 0.74, durationSteps: 2 },
      { bar: 1, step: 14, role: "fifth", velocity: 0.5, durationSteps: 2 },
      { bar: 2, step: 0, role: "root", velocity: 0.84, durationSteps: 2 },
      { bar: 2, step: 4, role: "third", velocity: 0.52, durationSteps: 2 },
      { bar: 2, step: 8, role: "root", velocity: 0.78, durationSteps: 2 },
      { bar: 2, step: 13, role: "fifth", velocity: 0.58, durationSteps: 1 },
      { bar: 2, step: 14, role: "octaveRoot", velocity: 0.62, durationSteps: 2 },
      { bar: 3, step: 0, role: "root", velocity: 0.78, durationSteps: 2 },
      { bar: 3, step: 6, role: "fifth", velocity: 0.54, durationSteps: 2 },
      { bar: 3, step: 12, role: "root", velocity: 0.5, durationSteps: 3 }
    ]
  },
  {
    id: "simple_pop_arp_01",
    styles: ["simple"],
    type: "arp",
    bars: 4,
    events: [
      { bar: 0, step: 0, role: "root", velocity: 0.86, durationSteps: 2 },
      { bar: 0, step: 2, role: "fifth", velocity: 0.64, durationSteps: 2 },
      { bar: 0, step: 4, role: "octaveRoot", velocity: 0.7, durationSteps: 2 },
      { bar: 0, step: 8, role: "root", velocity: 0.8, durationSteps: 2 },
      { bar: 0, step: 10, role: "fifth", velocity: 0.6, durationSteps: 2 },
      { bar: 0, step: 14, role: "fifth", velocity: 0.56, durationSteps: 2 },
      { bar: 1, step: 0, role: "root", velocity: 0.82, durationSteps: 2 },
      { bar: 1, step: 4, role: "fifth", velocity: 0.58, durationSteps: 2 },
      { bar: 1, step: 8, role: "root", velocity: 0.76, durationSteps: 2 },
      { bar: 1, step: 14, role: "fifth", velocity: 0.52, durationSteps: 2 },
      { bar: 2, step: 0, role: "root", velocity: 0.84, durationSteps: 2 },
      { bar: 2, step: 2, role: "fifth", velocity: 0.62, durationSteps: 2 },
      { bar: 2, step: 8, role: "root", velocity: 0.78, durationSteps: 2 },
      { bar: 2, step: 9, role: "root", velocity: 0.56, durationSteps: 1 },
      { bar: 2, step: 12, role: "third", velocity: 0.52, durationSteps: 2 },
      { bar: 2, step: 14, role: "fifth", velocity: 0.56, durationSteps: 2 },
      { bar: 3, step: 0, role: "root", velocity: 0.78, durationSteps: 2 },
      { bar: 3, step: 6, role: "fifth", velocity: 0.54, durationSteps: 2 },
      { bar: 3, step: 10, role: "fifth", velocity: 0.52, durationSteps: 2 },
      { bar: 3, step: 14, role: "root", velocity: 0.5, durationSteps: 3 }
    ]
  },
  {
    id: "warm_nylon_story_01",
    styles: ["warm"],
    type: "arp",
    bars: 4,
    events: [
      { bar: 0, step: 0, role: "root", velocity: 0.82, durationSteps: 3 },
      { bar: 0, step: 3, role: "fifth", velocity: 0.58, durationSteps: 2 },
      { bar: 0, step: 8, role: "third", velocity: 0.52, durationSteps: 2 },
      { bar: 0, step: 11, role: "fifth", velocity: 0.56, durationSteps: 2 },
      { bar: 1, step: 0, role: "root", velocity: 0.78, durationSteps: 3 },
      { bar: 1, step: 6, role: "fifth", velocity: 0.54, durationSteps: 2 },
      { bar: 1, step: 12, role: "octaveRoot", velocity: 0.58, durationSteps: 2 },
      { bar: 2, step: 0, role: "root", velocity: 0.82, durationSteps: 2 },
      { bar: 2, step: 4, role: "fifth", velocity: 0.58, durationSteps: 2 },
      { bar: 2, step: 8, role: "root", velocity: 0.74, durationSteps: 2 },
      { bar: 2, step: 13, role: "fifth", velocity: 0.52, durationSteps: 1 },
      { bar: 3, step: 0, role: "root", velocity: 0.76, durationSteps: 3 },
      { bar: 3, step: 8, role: "fifth", velocity: 0.52, durationSteps: 2 },
      { bar: 3, step: 14, role: "root", velocity: 0.48, durationSteps: 3 }
    ]
  },
  {
    id: "warm_nylon_story_02",
    styles: ["warm"],
    type: "arp",
    bars: 4,
    events: [
      { bar: 0, step: 0, role: "root", velocity: 0.82, durationSteps: 2 },
      { bar: 0, step: 2, role: "fifth", velocity: 0.56, durationSteps: 2 },
      { bar: 0, step: 7, role: "third", velocity: 0.5, durationSteps: 2 },
      { bar: 0, step: 12, role: "fifth", velocity: 0.54, durationSteps: 2 },
      { bar: 1, step: 0, role: "root", velocity: 0.76, durationSteps: 2 },
      { bar: 1, step: 8, role: "fifth", velocity: 0.52, durationSteps: 2 },
      { bar: 2, step: 0, role: "root", velocity: 0.8, durationSteps: 2 },
      { bar: 2, step: 4, role: "fifth", velocity: 0.56, durationSteps: 2 },
      { bar: 2, step: 8, role: "octaveRoot", velocity: 0.58, durationSteps: 2 },
      { bar: 2, step: 9, role: "fifth", velocity: 0.52, durationSteps: 1 },
      { bar: 2, step: 14, role: "fifth", velocity: 0.5, durationSteps: 2 },
      { bar: 3, step: 0, role: "root", velocity: 0.74, durationSteps: 3 },
      { bar: 3, step: 10, role: "fifth", velocity: 0.5, durationSteps: 2 },
      { bar: 3, step: 14, role: "root", velocity: 0.46, durationSteps: 3 }
    ]
  },
  {
    id: "calm_sparse_arp_01",
    styles: ["calm"],
    type: "arp",
    bars: 4,
    events: [
      { bar: 0, step: 0, role: "root", velocity: 0.76, durationSteps: 3 },
      { bar: 0, step: 8, role: "fifth", velocity: 0.52, durationSteps: 3 },
      { bar: 1, step: 0, role: "root", velocity: 0.72, durationSteps: 3 },
      { bar: 1, step: 12, role: "fifth", velocity: 0.5, durationSteps: 2 },
      { bar: 2, step: 0, role: "root", velocity: 0.74, durationSteps: 2 },
      { bar: 2, step: 8, role: "octaveRoot", velocity: 0.54, durationSteps: 2 },
      { bar: 2, step: 13, role: "fifth", velocity: 0.5, durationSteps: 1 },
      { bar: 3, step: 0, role: "root", velocity: 0.7, durationSteps: 3 },
      { bar: 3, step: 10, role: "fifth", velocity: 0.48, durationSteps: 2 },
      { bar: 3, step: 14, role: "root", velocity: 0.44, durationSteps: 3 }
    ]
  }
];

const SAFE_GENERATED_PHRASE_IDS = new Set([
  "a_simple_folk_guitar_arpeggio_03_90bpm",
  "a_simple_folk_guitar_arpeggio_06_84bpm",
  "a_simple_folk_guitar_arpeggio_09_93bpm",
  "a_nylon_guitar_arpeggio_a_nylon_guitar_arpeggio_19_82bpm",
  "a_nylon_guitar_arpeggio_a_nylon_guitar_arpeggio_20_86bpm"
]);

const SAFE_GENERATED_GROOVE_IDS = new Set([
  "b_b_soft_pop_groove_05_84bpm",
  "b_b_simple_folk_groove_01_84bpm",
  "b_b_reggae_offbeat_groove_13_84bpm",
  "b_b_house_offbeat_hat_groove_17_84bpm",
  "b_b_syncopated_pop_groove_21_84bpm",
  "b_b_light_rock_pop_groove_09_84bpm"
]);

function getGeneratedPhraseLibrarySafe() {
  const lib = Array.isArray(self.GENERATED_PHRASE_LIBRARY) ? self.GENERATED_PHRASE_LIBRARY : [];
  return lib.filter((p) => p && SAFE_GENERATED_PHRASE_IDS.has(p.id));
}

function getGeneratedGrooveLibrarySafe() {
  const lib = Array.isArray(self.GENERATED_GROOVE_LIBRARY) ? self.GENERATED_GROOVE_LIBRARY : [];
  return lib.filter((g) => g && SAFE_GENERATED_GROOVE_IDS.has(g.id));
}

function getStylePreset(config) {
  const styleName = config?.style || "warm";
  return { styleName, style: STYLE_PRESETS[styleName] || STYLE_PRESETS.warm };
}

function getArrangementPreset(styleName) {
  return ARRANGEMENT_PRESETS[styleName] || ARRANGEMENT_PRESETS.warm;
}

function selectMotifForStyle(styleName, seed) {
  const exact = MOTIF_LIBRARY.filter((m) => Array.isArray(m.styles) && m.styles.includes(styleName));
  const fallback = MOTIF_LIBRARY.filter((m) => Array.isArray(m.styles) && m.styles.includes("default"));
  const pool = exact.length > 0 ? exact : fallback;
  const motif = pool[Math.abs(Number(seed || 1)) % pool.length] || fallback[0];
  if (motif) {
    console.log(`[PageSynth Motif] selected: ${motif.id}`);
  }
  return motif;
}

function selectGrooveForStyle(styleName, seed) {
  const pool = GROOVE_LIBRARY.filter((g) => Array.isArray(g.styles) && g.styles.includes(styleName));
  const fallback = GROOVE_LIBRARY.filter((g) => Array.isArray(g.styles) && g.styles.includes("warm"));
  const list = pool.length > 0 ? pool : fallback;
  const groove = list[Math.abs(Number(seed || 1)) % list.length] || list[0];
  if (groove) {
    console.log(`[PageSynth Groove] selected: ${groove.id}`);
    console.log("[PageSynth Groove] kick:", groove.kick.map((x) => `${x.step}:${x.velocity}`).join(","));
    console.log("[PageSynth Groove] hat:", groove.hat.map((x) => `${x.step}:${x.velocity}`).join(","));
    console.log("[PageSynth Groove] bassRhythm:", groove.bassRhythm.map((x) => `${x.step}:${x.velocity}`).join(","));
    console.log("[PageSynth Groove] blipRhythm:", groove.blipRhythm.map((x) => `${x.step}:${x.velocity}`).join(","));
  }
  return groove;
}

function selectGeneratedGrooveForStyle(styleName, seed) {
  if (!hybridState.selectedGeneratedGrooveByStyle || typeof hybridState.selectedGeneratedGrooveByStyle !== "object") {
    hybridState.selectedGeneratedGrooveByStyle = {};
  }
  if (hybridState.selectedGeneratedGrooveByStyle[styleName]) {
    return hybridState.selectedGeneratedGrooveByStyle[styleName];
  }

  const safeLib = getGeneratedGrooveLibrarySafe();
  let pool = safeLib.filter((g) => Array.isArray(g.styles) && g.styles.includes(styleName));
  if (styleName === "bright" || styleName === "folk" || styleName === "pianoPop") {
    pool = pool.filter((g) => !String(g.id || "").includes("house_offbeat_hat"));
  }
  if (pool.length === 0) return null;

  const groove = pool[Math.abs(Number(seed || 1)) % pool.length] || null;
  if (groove) {
    hybridState.selectedGeneratedGrooveByStyle[styleName] = groove;
    console.log(`[PageSynth Groove] locked generated groove: ${groove.id}`);
  }
  return groove;
}

function getGrooveHitAtStep(groove, part, barInGroove, step, globalStep) {
  const hits = groove?.[part] || [];
  if (!Array.isArray(hits) || hits.length === 0) {
    return { hit: false, velocity: 0, type: "", durationSteps: 1, accent: false, tieTo: null };
  }
  if (Number.isFinite(Number(hits[0]?.bar))) {
    const h = hits.find((x) => Number(x.bar) === barInGroove && Number(x.step) === step);
    if (!h) return { hit: false, velocity: 0, type: "", durationSteps: 1, accent: false, tieTo: null };
    return {
      hit: true,
      velocity: clamp(Number(h.velocity || 0.7), 0.05, 1.2),
      type: part === "openHat" ? "openHat" : part,
      durationSteps: 1,
      accent: false,
      tieTo: null
    };
  }
  return hitAtGlobalStep(hits, globalStep);
}

function getGrooveDrumVelocityMultiplier(styleName, part, grooveId = "") {
  const isSoft = ["simple", "warm", "calm"].includes(styleName);
  const isBright = styleName === "bright";
  const isHouse = String(grooveId).includes("house_offbeat_hat");
  if (styleName === "folk") {
    if (part === "kick") return 0.20;
    if (part === "snare" || part === "clap") return 0.07;
    if (part === "hat") return 0.52;
    if (part === "openHat") return 0.52;
  }
  if (styleName === "pianoPop") {
    if (part === "kick") return 0.22;
    if (part === "snare" || part === "clap") return 0.04;
    if (part === "hat") return 0.52;
    if (part === "openHat") return 0.52;
  }
  if (styleName === "tech") {
    if (part === "kick") return 0.46;
    if (part === "snare" || part === "clap") return 0.22;
    if (part === "hat") return 0.6;
    if (part === "openHat") return 0.5;
  }
  if (styleName === "industrial") {
    if (part === "kick") return 0.56;
    if (part === "snare" || part === "clap") return 0.26;
    if (part === "hat") return 0.62;
    if (part === "openHat") return 0.54;
  }
  if (styleName === "simple") {
    if (part === "kick") return 0.18;
    if (part === "snare" || part === "clap") return 0.03;
    if (part === "hat") return 0.50;
    if (part === "openHat") return 0.44;
  }
  if (styleName === "warm") {
    if (part === "kick") return 0.22;
    if (part === "snare" || part === "clap") return 0.04;
    if (part === "hat") return 0.54;
    if (part === "openHat") return 0.54;
  }
  if (styleName === "calm") {
    if (part === "kick") return 0.26;
    if (part === "snare" || part === "clap") return 0.09;
    if (part === "hat") return 0.56;
    if (part === "openHat") return 0.56;
  }
  if (isSoft) {
    if (part === "kick") return 0.18;
    if (part === "snare" || part === "clap") return 0.03;
    if (part === "hat") return 0.50;
    if (part === "openHat") return 0.44;
  }
  if (isBright || isHouse) {
    if (part === "kick") return 0.78;
    if (part === "snare" || part === "clap") return 0.24;
    if (part === "hat") return 0.58;
    if (part === "openHat") return 0.58;
  }
  return 1.0;
}

function playPadArpeggio(chord, time, stepDuration, styleName = "warm") {
  if (!audioContext || !audioGraph || !chord) return;
  let tones;
  try {
    tones = getSafePadVoicing(chord, styleName);
  } catch (_) {
    return;
  }

  const style = activeStylePreset || STYLE_PRESETS.warm;
  const roleMap = {};
  for (const t of tones) roleMap[t.role] = t.midi;
  const root = clamp(roleMap.root ?? tones[0]?.midi ?? 48, 45, 60);
  const fifth = clamp(roleMap.fifth ?? (root + 7), 50, 64);
  const third = clamp(roleMap.third ?? (root + 3), 50, 63);
  const octaveRoot = clamp(roleMap.octaveRoot ?? (root + 12), 57, 65);

  // 保證至少有 root/fifth/third/octaveRoot
  const safe = {
    root,
    fifth,
    third,
    octaveRoot
  };

  const sequenceMap = {
    simple: ["root", "fifth", "octaveRoot", "fifth", "root", "fifth", "octaveRoot", "fifth"],
    warm: ["root", "fifth", "third", "fifth"],
    calm: ["root", "fifth", "octaveRoot", "fifth"],
    bright: ["root", "fifth", "third", "fifth", "octaveRoot", "fifth", "third", "fifth"]
  };
  const stepOffsetsMap = {
    simple: [0, 2, 4, 6, 8, 10, 12, 14],
    warm: [0, 3, 8, 11],
    calm: [0, 5, 8, 13],
    bright: [0, 2, 4, 6, 8, 10, 12, 14]
  };
  const gainScaleMap = { simple: 2.0, warm: 1.8, calm: 1.8, folk: 1.8, pianoPop: 2.2, bright: 1.8 };

  let seqRoles = sequenceMap[styleName] || sequenceMap.warm;
  let stepOffsets = stepOffsetsMap[styleName] || stepOffsetsMap.warm;
  const spacing = (styleName === "warm") ? (stepDuration * 3) : (stepDuration * 2);
  const roleGain = { root: 1.0, fifth: 0.85, third: 0.55, octaveRoot: 0.75 };
  const gainScale = gainScaleMap[styleName] || 1.8;

  const scheduled = [];
  const primarySample = getPadArpSampleName(styleName, barIndex);
  const fallbackSamples = getPadArpFallbackSamples(styleName);
  let arpNoteCount = (styleName === "simple" || styleName === "folk" || styleName === "pianoPop") ? 8 : 4;
  let dropIndex = -1;
  const phraseBar = barIndex % 4;
  let extraSubdivision = null;
  if (styleName === "simple") {
    if (phraseBar === 1) {
      const dropCandidates = [2, 5];
      dropIndex = dropCandidates[(hybridState.seed >>> 1) % dropCandidates.length];
      console.debug("[PageSynth Simple] arp dropped note:", { barIndex, dropIndex });
    }
    if (phraseBar === 2) {
      const addOffset = ((hybridState.seed + barIndex) % 2 === 0) ? 9 : 13;
      const addRole = ((hybridState.seed + barIndex) % 3 === 0) ? "root" : "fifth";
      extraSubdivision = { role: addRole, offset: addOffset, gainMul: 0.62, lenMul: 0.75 };
    }
    if (phraseBar === 3) {
      const endingRoot = ((hybridState.seed + barIndex) % 2 === 0);
      seqRoles = endingRoot
        ? ["root", "fifth", "octaveRoot", "fifth", "root", "fifth"]
        : ["root", "fifth", "octaveRoot", "fifth", "fifth", "root"];
      stepOffsets = [0, 2, 4, 6, 10, 14];
      arpNoteCount = 6;
    }
    if (currentStep === 0) {
      console.log("[PageSynth Simple] phrase bar:", phraseBar);
      console.log("[PageSynth Simple] phrase sequence:", seqRoles.join(" -> "));
      console.log("[PageSynth Simple] phrase offsets:", stepOffsets.join(","));
    }
  }
  if (styleName === "folk") {
    if (phraseBar === 0) {
      seqRoles = ["root", "fifth", "third", "fifth", "root", "fifth", "third", "fifth"];
      stepOffsets = [0, 2, 4, 6, 8, 10, 12, 14];
    } else if (phraseBar === 1) {
      seqRoles = ["root", "fifth", "third", "fifth", "root", "fifth"];
      stepOffsets = [0, 2, 4, 6, 10, 12];
      arpNoteCount = 6;
    } else if (phraseBar === 2) {
      seqRoles = ["root", "fifth", "third", "fifth", "root", "fifth", "third", "fifth"];
      stepOffsets = [0, 2, 4, 6, 8, 10, 12, 14];
      const addOffset = ((hybridState.seed + barIndex) % 2 === 0) ? 9 : 13;
      const addRole = ((hybridState.seed + barIndex) % 3 === 0) ? "root" : "fifth";
      extraSubdivision = { role: addRole, offset: addOffset, gainMul: 0.55, lenMul: 0.7 };
    } else {
      seqRoles = ["root", "fifth", "third", "fifth", "root"];
      stepOffsets = [0, 2, 4, 6, 10];
      arpNoteCount = 5;
    }
  }
  if (styleName === "pianoPop") {
    // v1.5: formula-driven arp
    const variant = getPianoPopVariant();
    const section = getArrangementSection(barIndex);
    const formula = getPianoPopSectionFormula(variant, section, hybridState.seed + barIndex);
    const arpF = formula.arpFormula;

    if (arpF && arpF.patterns) {
      const barIn4 = barIndex % 4;
      const pat = arpF.patterns[barIn4] || arpF.patterns[0];
      if (pat) {
        seqRoles = pat.roles;
        stepOffsets = pat.offsets;
        arpNoteCount = pat.roles.length;
        extraSubdivision = null;
      }
    }
    // fallback: keep original hardcoded pianoPop arp
    if (!seqRoles || seqRoles.length === 0) {
      if (phraseBar === 0) {
        seqRoles = ["root", "fifth", "third", "fifth", "octaveRoot", "fifth", "third", "fifth"];
        stepOffsets = [0, 2, 4, 6, 8, 10, 12, 14];
      } else if (phraseBar === 1) {
        seqRoles = ["root", "fifth", "third", "fifth", "root", "fifth", "third"];
        stepOffsets = [0, 2, 4, 6, 8, 10, 14];
        arpNoteCount = 7;
      } else if (phraseBar === 2) {
        seqRoles = ["root", "fifth", "third", "fifth", "root", "fifth", "third", "fifth", "root"];
        stepOffsets = [0, 2, 4, 6, 8, 9, 10, 12, 14];
        const addRole = ((hybridState.seed + barIndex) % 3 === 0) ? "root" : "fifth";
        extraSubdivision = { role: addRole, offset: 9, gainMul: 0.50, lenMul: 0.65 };
        arpNoteCount = 9;
      } else {
        seqRoles = ["root", "fifth", "third", "fifth", "root", "fifth"];
        stepOffsets = [0, 2, 4, 6, 10, 14];
        arpNoteCount = 6;
      }
    }
    // formula debug log (once per section)
    if (!formulaPlaybackLogged || formulaPlaybackSection !== section) {
      formulaPlaybackLogged = true;
      formulaPlaybackSection = section;
      console.log("[PageSynth Formula Playback] variant:", variant);
      console.log("[PageSynth Formula Playback] section:", section);
      console.log("[PageSynth Formula Playback] arp:", formula.arpFormulaKey, arpF ? arpF.name : "(fallback)");
      console.log("[PageSynth Formula Playback] bass:", formula.bassFormulaKey);
      console.log("[PageSynth Formula Playback] hh:", formula.hhFormulaKey);
    }
  }
  const canUsePhrase = ["simple", "warm", "calm", "bright", "folk"].includes(styleName);
  const phrase = canUsePhrase ? getLockedPhraseForStyle(styleName) : null;
  const phraseBars = Math.max(1, Number(phrase?.bars || 4));
  const barInPhrase = barIndex % phraseBars;
  const barEvents = Array.isArray(phrase?.events)
    ? phrase.events
      .filter((e) => Number(e.bar) === barInPhrase)
      .sort((a, b) => Number(a.step || 0) - Number(b.step || 0))
    : [];

  let phraseScheduled = false;
  if (canUsePhrase && phrase && barEvents.length > 0) {
    try {
      const denseGatedEvents = gatePhraseEventsForDensity(barEvents, styleName, hybridState.seed, barInPhrase);
      const sanitizeState = { simpleThirdKept: 0 };
      const sanitizedEvents = denseGatedEvents.map((ev, idx) => sanitizePhraseEventForStyle(ev, styleName, idx, hybridState.seed, sanitizeState));
      
      // bright: if events < 5 after sanitize, fallback to handwritten arp
      if (styleName === "bright" && sanitizedEvents.length < 5) {
        console.log("[PageSynth Bright] event count after sanitize: " + sanitizedEvents.length + " (too few, fallback to handwritten)");
        console.log("[PageSynth Bright] fallback to handwritten arp: true");
        phraseScheduled = false;
        // fall through to handwritten arp below
      } else {
        if (styleName === "bright") {
          console.log("[PageSynth Bright] event count after sanitize: " + sanitizedEvents.length);
          console.log("[PageSynth Bright] fallback to handwritten arp: false");
        }
        for (const ev of sanitizedEvents) {

        const role = ev.role || "root";
        let midi = clamp(resolvePhraseRoleMidi(role, safe), 48, 65);
        if (styleName === "simple" && role === "octaveRoot" && midi > 64) midi = clamp(midi - 12, 48, 64);
        const step = clamp(Number(ev.step || 0), 0, 15);
        const timingJitter = styleName === "simple" ? (((hybridState.seed + barIndex * 17 + step * 19) % 13) / 1000) : 0;
        const noteTime = time + step * stepDuration + timingJitter;
        const durSteps = Math.max(1, Number(ev.durationSteps || 2));
        const vel = clamp(Number(ev.velocity || 0.6), 0.25, 1.0);
        const noteLen = clamp(stepDuration * durSteps * 0.92, 0.34, 0.9);

        let played = false;
        let usedSample = null;
        const multiCandidates = getPadArpSampleCandidates(styleName);
        const candidatePool = (multiCandidates.length > 0 ? multiCandidates : [primarySample, ...fallbackSamples]).filter(Boolean);
        const uniquePool = [...new Set(candidatePool)];
        if (!padArpMultiSampleEnabledLogged && ["simple", "warm", "calm"].includes(styleName)) {
          padArpMultiSampleEnabledLogged = true;
          console.log("[PageSynth PadArp] multisample enabled");
        }
        const best = chooseBestInstrumentSampleForMidi(uniquePool, midi);
        const sampleOrder = best ? [best.name, ...uniquePool.filter((x) => x !== best.name)] : uniquePool;
        for (const s of sampleOrder) {
          if (playPadArpSampleNote(s, midi, role, noteTime, noteLen, styleName)) {
            played = true;
            usedSample = s;
            scheduled.push({ role, note: midiToNoteName(midi), midi, step, gain: Number(vel.toFixed(3)), len: Number(noteLen.toFixed(3)), source: s });
            break;
          }
        }
        if (usedSample && !padArpSampleLogSet.has(usedSample)) {
          padArpSampleLogSet.add(usedSample);
          console.log(`[PageSynth PadArp] using sample: ${usedSample}`);
        }
        if (!played) {
          scheduled.push({ role, note: midiToNoteName(midi), midi, step, gain: Number(vel.toFixed(3)), len: Number(noteLen.toFixed(3)), source: "fallback-pending" });
        }
        }
      }
      phraseScheduled = scheduled.length > 0;
      console.log("[PageSynth Phrase] generated phrase bar:", `${phrase.id}:bar${barInPhrase}`);
      console.log("[PageSynth Phrase] sanitized events:", sanitizedEvents.map((e) => `${e.step}:${e.role}:${Number(e.velocity || 0).toFixed(3)}`).join(","));
      console.log("[PageSynth Phrase] scheduled generated notes:", scheduled);
    } catch (_) {
      phraseScheduled = false;
    }
  }

  if (phraseScheduled) {
    if (currentStep === 0) {
      console.log("[PageSynth PadArp] chord:", { style: styleName, chord, barIndex });
      console.log("[PageSynth PadArp] arp sequence:", `phrase:${phrase.id}:bar${barInPhrase}`);
    }
    return;
  }
  for (let i = 0; i < arpNoteCount; i++) {
    if (i === dropIndex) continue;
    const role = seqRoles[i % seqRoles.length];
    let midi = clamp(safe[role] ?? root, 48, 65);
    if (styleName === "simple" && role === "octaveRoot" && midi > 64) {
      midi = clamp(midi - 12, 48, 64);
    }
    const timingJitter = styleName === "simple"
      ? (((hybridState.seed + barIndex * 17 + i * 29) % 19) / 1000)
      : 0;
    const firstNoteGuard = (styleName === "simple" && i === 0) ? Math.min(timingJitter, 0.006) : timingJitter;
    const noteTime = time + stepOffsets[i] * stepDuration + firstNoteGuard;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);

    let nGain = roleGain[role] || 0.7;
    if (styleName === "simple" && role === "octaveRoot") {
      nGain *= 0.84;
    }
    if (styleName === "simple" && i >= 4) {
      nGain *= 0.92;
    }
    if (styleName === "simple") {
      const velRand = 0.88 + (((hybridState.seed + barIndex * 11 + i * 7) % 18) / 100); // 0.88~1.05
      const rootStability = role === "root" ? 0.98 : 1;
      nGain *= velRand * rootStability;
    }
    let noteLen = Math.max(0.55, Math.min(0.9, spacing * 0.92));
    if (styleName === "simple" && phraseBar === 3 && i === (arpNoteCount - 1)) {
      noteLen = Math.max(noteLen, 0.72);
      nGain *= 0.86;
    }
    let usedSample = null;
    let samplePlayed = false;
    const multiCandidates = getPadArpSampleCandidates(styleName);
    const candidatePool = (multiCandidates.length > 0 ? multiCandidates : [primarySample, ...fallbackSamples]).filter(Boolean);
    const uniquePool = [...new Set(candidatePool)];
    if (!padArpMultiSampleEnabledLogged && ["simple", "warm", "calm"].includes(styleName)) {
      padArpMultiSampleEnabledLogged = true;
      console.log("[PageSynth PadArp] multisample enabled");
    }
    const best = chooseBestInstrumentSampleForMidi(uniquePool, midi);
    const sampleOrder = best ? [best.name, ...uniquePool.filter((x) => x !== best.name)] : uniquePool;
    for (const s of sampleOrder) {
      if (playPadArpSampleNote(s, midi, role, noteTime, noteLen, styleName)) {
        samplePlayed = true;
        usedSample = s;
        break;
      }
    }

    if (usedSample && !padArpSampleLogSet.has(usedSample)) {
      padArpSampleLogSet.add(usedSample);
      console.log(`[PageSynth PadArp] using sample: ${usedSample}`);
    }

    if (!samplePlayed && primarySample && !padArpFallbackLogSet.has(primarySample)) {
      padArpFallbackLogSet.add(primarySample || "multi");
      console.debug(`[PageSynth PadArp] sample fallback: ${primarySample || "multi"}`);
    }

    if (!samplePlayed) {
      const osc1 = audioContext.createOscillator();
      const osc2 = audioContext.createOscillator();
      const filter = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();
      const out = createVoiceOutput(
        { reverb: 0.08 + style.reverb * 0.08, delay: 0.0 + style.delay * 0.02 },
        MIX.pad * style.pad * gainScale
      );
      if (!out) continue;

      registerNode(osc1);
      registerNode(osc2);
      osc1.type = "triangle";
      osc2.type = "sine";
      osc1.frequency.setValueAtTime(freq, noteTime);
      osc2.frequency.setValueAtTime(freq * 1.002, noteTime);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(clamp(musicParams.filterCutoff * 0.9, 1800, 3500), noteTime);
      filter.Q.value = 0.7;

      const peak = 0.28 * nGain;
      gain.gain.setValueAtTime(0.0001, noteTime);
      gain.gain.linearRampToValueAtTime(peak, noteTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(peak * 0.42, noteTime + 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + noteLen);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(out);

      osc1.start(noteTime);
      osc2.start(noteTime);
      osc1.stop(noteTime + noteLen + 0.06);
      osc2.stop(noteTime + noteLen + 0.06);
      scheduled.push({ role, note: midiToNoteName(midi), midi, offset: Number((stepOffsets[i] * stepDuration).toFixed(3)), gain: Number(peak.toFixed(3)), source: "synth" });
    } else {
      scheduled.push({ role, note: midiToNoteName(midi), midi, offset: Number((stepOffsets[i] * stepDuration).toFixed(3)), gain: Number((0.22 * nGain).toFixed(3)), source: usedSample });
    }
  }

  if ((styleName === "simple" || styleName === "pianoPop") && extraSubdivision) {
    const subRole = extraSubdivision.role;
    let subMidi = clamp(safe[subRole] ?? root, 48, 64);
    if (subRole === "octaveRoot" && subMidi > 64) subMidi = clamp(subMidi - 12, 48, 64);
    const subTime = time + extraSubdivision.offset * stepDuration + Math.min((((hybridState.seed + barIndex * 23) % 11) / 1000), 0.01);
    const subLen = Math.max(0.35, Math.min(0.52, spacing * extraSubdivision.lenMul));
    const subGain = (roleGain[subRole] || 0.7) * extraSubdivision.gainMul;
    const subSampleOrder = [primarySample, ...fallbackSamples].filter(Boolean);
    let subPlayed = false;
    for (const s of subSampleOrder) {
      if (playPadArpSampleNote(s, subMidi, subRole, subTime, subLen, styleName)) {
        subPlayed = true;
        scheduled.push({ role: `${subRole}-sub`, note: midiToNoteName(subMidi), midi: subMidi, offset: Number((extraSubdivision.offset * stepDuration).toFixed(3)), gain: Number((0.22 * subGain).toFixed(3)), source: s });
        break;
      }
    }
    if (!subPlayed) {
      scheduled.push({ role: `${subRole}-sub`, note: midiToNoteName(subMidi), midi: subMidi, offset: Number((extraSubdivision.offset * stepDuration).toFixed(3)), gain: Number((0.22 * subGain).toFixed(3)), source: "skipped" });
    }
  }

  if (currentStep === 0) {
    console.log("[PageSynth PadArp] chord:", { style: styleName, chord, barIndex });
    console.log("[PageSynth PadArp] arp sequence:", seqRoles.join(" -> "));
    console.log("[PageSynth PadArp] scheduled notes:", scheduled);
    if (styleName === "bright") {
      const brightArpNotes = scheduled.map((s) => ({
        role: s.role,
        midi: s.midi,
        noteName: s.note || midiToNoteName(s.midi),
        stepOffset: s.step !== undefined ? s.step : (s.offset !== undefined ? s.offset : "?"),
        velocity: s.gain || s.velocity || "?",
        source: s.source || (phraseScheduled ? "generated" : "handwritten")
      }));
      console.log("[PageSynth Bright Debug] arp notes:", JSON.stringify(brightArpNotes));
    }
    if (styleName === "pianoPop") {
      console.log("[PageSynth PianoPop] padArp routing: arpeggio");
      console.log("[PageSynth PianoPop] chord:", { barIndex, chord });
      console.log("[PageSynth PianoPop] arp sequence:", seqRoles.join(" -> "));
      const pianoPopArpNotes = scheduled.map((s) => ({
        role: s.role,
        midi: s.midi,
        noteName: s.note || midiToNoteName(s.midi),
        stepOffset: s.step !== undefined ? s.step : (s.offset !== undefined ? s.offset : "?"),
        sampleName: s.source || "?",
        gain: s.gain || s.velocity || "?"
      }));
      console.log("[PageSynth PianoPop] scheduled notes:", JSON.stringify(pianoPopArpNotes));
    }
  }

// ============================================
// Step Sequencer 排程
// ============================================

// --- Song Form / Arrangement Engine v0.7 ---
function getArrangementSection(barIndex) {
  const s = (barIndex % 32 + 32) % 32;
  if (s < 4) return "intro";
  if (s < 12) return "main";
  if (s < 20) return "variation";
  if (s < 24) return "break";
  return "return";
}
let arrangementDebugLogged = false;
let warmBodyLogged = false;

// warm body layer: very subtle chord pad for warmth
function playWarmBodyLayer(chord, time) {
  if (!audioContext || !audioGraph) return;
  const ctx = audioContext;
  const style = activeStylePreset || STYLE_PRESETS.warm;
  let tones;
  try { tones = getSafePadVoicing(chord, "warm"); } catch (_) { return; }
  const roleMap = {};
  for (const t of tones) roleMap[t.role] = t.midi;
  const root = clamp(roleMap.root ?? 48, 45, 60);
  const fifth = clamp(roleMap.fifth ?? (root + 7), 50, 64);

  for (const midi of [root, fifth]) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    const out = createVoiceOutput({ reverb: 0.02 + style.reverb * 0.06, delay: 0.0 }, MIX.pad * style.pad * 0.12);
    if (!out) { osc.disconnect(); return; }
    registerNode(osc);
    osc.type = "sine";
    lp.type = "lowpass";
    lp.frequency.value = clamp(musicParams.filterCutoff * 0.45, 900, 1400);
    lp.Q.value = 0.4;
    const len = clamp(musicParams.bpm ? (240 / musicParams.bpm) : 2.5, 1.5, 3.5);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.06, time + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.02, time + len * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, time + len);
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(lp);
    lp.connect(gain);
    gain.connect(out);
    osc.start(time);
    osc.stop(time + len + 0.06);
  }
}

/**
 * 排程一個 step（1/16 小節）
 * @param {number} stepDuration - 每個 step 的持續時間（秒）
 */
function scheduleStep(stepDuration) {
  if (!isPlaying || !audioContext) return;

  let time = nextStepTime;
  const step = currentStep;
  const styleName = currentLiveCodeConfig?.style || "warm";
  if (hybridState.enabled && (step % 2 === 1)) {
    time += hybridState.swing;
  }

  // --- Arrangement section gating v0.7 ---
  const section = getArrangementSection(barIndex);
  const isArranged = styleName === "warm" || styleName === "pianoPop";
  const sectionMuteBass = isArranged && (section === "intro" || section === "break");
  const sectionMuteDrums = isArranged && (section === "intro" || section === "break");
  const sectionMuteHH = isArranged && (styleName === "pianoPop" ? (section === "intro" || section === "break") : true);

  if (step === 0 && !arrangementDebugLogged) {
    arrangementDebugLogged = true;
    console.log("[PageSynth Arrangement] section:", { barIndex, section, style: styleName });
    if (sectionMuteBass) console.log("[PageSynth Arrangement] muted bass in section:", section);
    // formula library debug (once per session)
    if (!formulaDebugLogged && styleName === "pianoPop") {
      formulaDebugLogged = true;
      const sf = SECTION_FORMULAS[section] || SECTION_FORMULAS.main;
      const arpKey = Array.isArray(sf.arp) ? sf.arp[0] : sf.arp;
      const hhKey = Array.isArray(sf.hh) ? sf.hh[0] : sf.hh;
      console.log("[PageSynth Formula] piano arp:", PIANO_ARP_FORMULAS[arpKey]?.name || arpKey);
      console.log("[PageSynth Formula] bass:", BASS_FORMULAS[sf.bass]?.name || sf.bass);
      console.log("[PageSynth Formula] hh:", HH_FORMULAS[hhKey]?.name || hhKey);
      console.log("[PageSynth Formula] section:", section);
    }
    if (sectionMuteDrums) console.log("[PageSynth Arrangement] muted drums in section:", section);
  }

  // --- kick ---
  const humanize = hybridState.enabled && hybridState.humanize && (activeStylePreset?.mutation ?? 0) <= 0.1;
  const timingJitter = humanize ? (((hybridState.seed + step * 19) % 26) / 1000) : 0;
  const voiceTime = time + timingJitter;
  const kickHit = normalizeStepHit(stepData.kick[step]);
  if (kickHit.hit && !sectionMuteDrums) {
    playKick(voiceTime, { gainMul: kickHit.velocity });
  }

  // --- hat ---
  const hatHit = normalizeStepHit(stepData.hat[step]);
  if (hatHit.hit && !sectionMuteHH) {
    if (hatHit.type === "openHat") {
      playOpenHat(voiceTime, { gainMul: hatHit.velocity * (hatHit.accent ? 1.08 : 1), durationMul: hatHit.durationSteps || 2 });
    } else {
      playHat(voiceTime, { gainMul: hatHit.velocity * (hatHit.accent ? 1.06 : 1) });
    }
  }

  // --- snare/clap (generated groove drums) ---
  const warmBackbeatCut = styleName === "warm" ? 0.25 : 1;
  const snareHit = normalizeStepHit(stepData?.snare?.[step]);
  if (snareHit.hit && !sectionMuteDrums) {
    playSnare(voiceTime, { gainMul: snareHit.velocity * warmBackbeatCut });
  }
  const clapHit = normalizeStepHit(stepData?.clap?.[step]);
  if (clapHit.hit && !sectionMuteDrums) {
    playClap(voiceTime, { gainMul: clapHit.velocity * warmBackbeatCut });
  }

  // --- bass ---
  const bassNote = stepData.bass[step];
  if (bassNote !== null && !sectionMuteBass) {
    const durSteps = Math.max(1, Number(stepData?.bassDurationSteps?.[step] || 1));
    const styleName = currentLiveCodeConfig?.style || "warm";
    const isSoftBassStyle = ["simple", "warm", "calm", "folk", "pianoPop"].includes(styleName);
    const padArpSameStep = isSoftBassStyle && step === 0 && (stepData.padChords || []).length > 0;
    const bassDuckMul = padArpSameStep ? 0.95 : 1;
    const bassDurMul = (styleName === "warm" || styleName === "pianoPop") ? 0.88 : 0.65;
    playBass(bassNote, voiceTime, stepDuration * bassDurMul * durSteps * bassDuckMul);
  }

  // --- Bass V2: warm/pianoPop chord-aligned bass ---
  if (styleName === "warm" || styleName === "pianoPop") {
    // pianoPop: root-only [0, 4, 12]  |  warm: root-only [0, 8]
    const bassV2Steps = styleName === "pianoPop" ? [0, 4, 12] : [0, 8];
    const padChordList = stepData.padChords || [];
    if (bassV2Steps.includes(step) && padChordList.length > 0 && !sectionMuteBass) {
      const chord = padChordList[barIndex % padChordList.length];
      let rootMidi = 45;
      try {
        const parsed = parseChord(chord);
        const rootName = parsed.root;
        // fixed safe root mapping: A2~G3, MIDI 45~55
        const rootMap = {
          C: 48, "C#": 49, D: 50, "D#": 51, E: 52, F: 53,
          "F#": 54, G: 55, "G#": 44, A: 45, "A#": 46, B: 47
        };
        rootMidi = rootMap[rootName] || 45;
        // warm & pianoPop: G chord → B2 for bass line colour
        if ((styleName === "pianoPop" || styleName === "warm") && rootName === "G") rootMidi = 47;
        rootMidi = clamp(rootMidi, 43, 62);
      } catch (_) { rootMidi = 45; }

      const v2Duration = stepDuration * 0.62;
      playBassV2Note(rootMidi, voiceTime, v2Duration, styleName);

      if (step === 0 && !bassV2DebugLogged) {
        bassV2DebugLogged = true;
        const isSynthBassV2 = styleName === "pianoPop" || styleName === "warm";
        const notes = bassV2Steps.map((s) => ({
          style: styleName, barIndex, chord,
          bassTarget: (isSynthBassV2 && chord.startsWith("G")) ? "B2" : midiToNoteName(rootMidi),
          step: s, role: "root", midi: rootMidi,
          freq: Math.round(440 * Math.pow(2, (rootMidi - 69) / 12)),
          noteName: midiToNoteName(rootMidi),
          source: isSynthBassV2 ? "synth" : "sample+synth"
        }));
        console.log("[PageSynth BassV2] notes:", notes);
      }
    }
  }

  // --- blip ---
  const softBlipMuted = ["simple", "warm", "calm", "folk", "pianoPop"].includes(styleName);
  const blipNote = stepData.blip[step];
  if (blipNote !== null && !softBlipMuted) {
    const g = stepData?.blipGain?.[step] || 1;
    const durSteps = Math.max(1, Number(stepData?.blipDurationSteps?.[step] || 1));
    playBlip(blipNote, voiceTime, stepDuration * 0.4 * durSteps, { gainMul: g });
  }

  const padChordList = stepData.padChords || [];
  if (step === 0 && padChordList.length > 0) {
    const padChord = padChordList[barIndex % padChordList.length];
    if (styleName === "bright") {
      console.log("[PageSynth Bright Debug] chord:", JSON.stringify({ barIndex, chordIndex: barIndex % padChordList.length, chord: padChord, padChordList }));
    }
    const humanSeed = ((hybridState.seed || 1) + barIndex * 131) >>> 0;
    const timeOffset = ((humanSeed % 31) / 1000); // 0~0.03s
    const lenMul = 0.85 + ((humanSeed % 21) / 100); // 0.85~1.05
    const gainMul = 0.9 + (((humanSeed >>> 3) % 21) / 100); // 0.9~1.1
    const padLen = stepDuration * 16 * (hybridState.padLengthMul || 1) * lenMul;
    if (["simple", "warm", "calm", "bright", "folk", "pianoPop"].includes(styleName)) {
      playPadArpeggio(padChord, time + timeOffset, stepDuration, styleName);
    } else {
      playPadChord(padChord, time + timeOffset, padLen, {
        brightness: hybridState.padBrightness || 1,
        gainMul: (hybridState.padGainMul || 1) * gainMul
      });
    }
    console.log(`[PageSynth Music] pad chord bar: ${barIndex + 1} ${padChord}`);
    // warm body layer: subtle chord pad
    if (styleName === "warm") {
      playWarmBodyLayer(padChord, time + timeOffset);
      if (!warmBodyLogged) {
        warmBodyLogged = true;
        console.log("[PageSynth Warm] body layer:", { barIndex, chord: padChord });
      }
    }
  }

  // 前進到下一個 step
  currentStep = (step + 1) % 16;
  nextStepTime += stepDuration;

  // 每 16 步（一個 pattern 循環）重新產生 sequencer
  if (currentStep === 0) {
    barIndex++;
    regenerateSequencer();
  }
}

/**
 * 啟動排程器
 */
function startScheduler(ctx) {
  const bpm = musicParams.bpm;
  // 每個 step = 1/4 拍 = 60 / BPM / 4 秒
  const stepDuration = 60 / bpm / 4;

  // 初始時間
  nextStepTime = ctx.currentTime + 0.05;
  currentStep = 0;
  barIndex = 0;

  // 第一次產生 sequencer
  regenerateSequencer();

  // 每 50ms 檢查並排程未來的 steps
  scheduleInterval = setInterval(() => {
    if (!isPlaying) return;

    // 排程未來 0.5 秒內的 steps
    while (nextStepTime < ctx.currentTime + 0.5) {
      scheduleStep(stepDuration);
    }
  }, 50);

  // 立即排程第一個 step
  scheduleStep(stepDuration);
}

// ============================================
// 音樂控制
// ============================================

/**
 * 開始播放音樂
 * @param {Object} pageData - 網頁統計資料
 */
async function startMusic(pageData) {
  let sessionId = 0;
  try {
    // 避免疊加多個 sequencer
    hardStopAllAudio();
    // stop 舊音訊後建立新 session
    sessionId = ++audioSessionId;

    // deterministic seed：同頁相近、不同頁差異明顯
    rngSeed = createSeedFromPageData(pageData);
    console.log("[PageSynth Audio] variationSeed:", Number(pageData?.variationSeed || 0));

    const requestedMode = pageData?.__mode === "pageData" ? "pageData" : "hybrid";

    if (requestedMode === "hybrid" && currentLiveCodeConfig && pageData) {
      currentMode = "hybrid-live-code";
      const { styleName, style } = getStylePreset(currentLiveCodeConfig);
      const arrangement = getArrangementPreset(styleName);
      activeStylePreset = style;
      console.log(`[PageSynth Style] style: ${styleName}`);
      const hybrid = computeHybridState(pageData, currentLiveCodeConfig);
      hybridState = {
        enabled: true,
        pageBpmOffset: hybrid.pageBpmOffset,
        hatMutationRate: clamp(hybrid.hatMutationRate * style.mutation, 0, 0.35),
        pitchOffset: hybrid.pitchOffset,
        cutoff: clamp(hybrid.filterCutoff * style.cutoffBias, 500, 7000),
        seed: hybrid.seed,
        bassDebugCounter: 0,
        swing: clamp((hybrid.swing * 0.25) + (style.swing || 0), 0, 0.05),
        blipRotate: hybrid.blipRotate,
        bassRotate: hybrid.bassRotate,
        mutationScale: style.mutation,
        humanize: ["warm", "calm", "folk", "pianoPop", "bright", "ambient"].includes(styleName),
        padBrightness: clamp((hybrid.filterCutoff * style.cutoffBias / 2400), 0.75, 1.25),
        padLengthMul: arrangement.padMode === "drone" ? 1.2 : (arrangement.padMode === "long" ? 1.08 : (arrangement.padMode === "pulse" ? 0.82 : 0.9)),
        padGainMul: clamp(0.9 + ((hybrid.seed % 9) / 100), 0.9, 1.05),
        selectedGeneratedGrooveByStyle: {}
      };
      if (styleName === "warm" || styleName === "calm" || styleName === "folk" || styleName === "pianoPop") hybridState.padGainMul *= 0.9;
      if (styleName === "bright") hybridState.padGainMul *= 0.94;
      if (styleName === "industrial") hybridState.padGainMul *= 0.86;
      const pitchMax = styleName === "industrial" ? 12 : ((styleName === "bright" || styleName === "tech") ? 5 : 3);
      musicParams = {
        bpm: hybrid.bpm,
        density: arrangement.density || hybrid.density,
        pitchOffset: clamp(hybrid.pitchOffset, 0, pitchMax),
        filterCutoff: clamp(hybrid.filterCutoff * style.cutoffBias, 500, 7000)
      };
      hybridState.pitchOffset = musicParams.pitchOffset;
      stepData = buildHybridStepData(currentLiveCodeConfig, pageData, hybridState);
      if (currentLiveCodeConfig?.key || currentLiveCodeConfig?.chords) {
        const keyObj = currentLiveCodeConfig?.key || { root: "A", mode: "minor" };
        const chords = (currentLiveCodeConfig?.chords && currentLiveCodeConfig.chords.length > 0)
          ? currentLiveCodeConfig.chords
          : defaultChordsByKey(keyObj);
        console.log(`[PageSynth Music] key/chords: ${keyObj.root} ${keyObj.mode}, ${chords.join(" ")}`);
      }
      if (currentLiveCodeConfig?.padAuto) {
        console.log("[PageSynth Music] pad auto enabled");
      }
      melodyNotes = (currentLiveCodeConfig.scale === "majorPentatonic" ? MAJOR_PENTATONIC : MINOR_PENTATONIC).map((s) => 60 + s);
      melodyIndex = 0;
      console.log("[PageSynth Audio] using hybrid live code mode");
      console.log("[PageSynth Audio] hybrid page influence", {
        baseBpm: hybrid.baseBpm,
        finalBpm: musicParams.bpm,
        bpmOffset: hybridState.pageBpmOffset,
        pitchOffset: hybridState.pitchOffset,
        cutoff: musicParams.filterCutoff,
        swing: hybridState.swing,
        hatMutationRate: hybridState.hatMutationRate,
        blipRotate: hybridState.blipRotate,
        bassRotate: hybridState.bassRotate,
        seed: hybridState.seed
      });
      console.log("[PageSynth Style] active mix:", {
        style: styleName,
        kick: style.kick,
        hat: style.hat,
        bass: style.bass,
        blip: style.blip,
        pad: style.pad,
        saturation: style.saturation,
        reverb: style.reverb,
        mutation: style.mutation
      });
      console.log("[PageSynth Mix] drum balance:", {
        kick: style.kick,
        hat: style.hat,
        openHat: clamp(style.hat * 1.9, 0, 1),
        bass: style.bass
      });
      if (styleName === "warm") {
        console.log("[PageSynth Mix] warm drum cut:", {
          kick: getGrooveDrumVelocityMultiplier("warm", "kick"),
          hat: getGrooveDrumVelocityMultiplier("warm", "hat"),
          openHat: getGrooveDrumVelocityMultiplier("warm", "openHat"),
          snare: getGrooveDrumVelocityMultiplier("warm", "snare"),
          clap: getGrooveDrumVelocityMultiplier("warm", "clap")
        });
        console.log("[PageSynth Mix] warm backbeat cut:", {
          snare: getGrooveDrumVelocityMultiplier("warm", "snare"),
          clap: getGrooveDrumVelocityMultiplier("warm", "clap")
        });
      }
      if (styleName === "folk") {
        console.log("[PageSynth Mix] folk drum cut:", {
          kick: getGrooveDrumVelocityMultiplier("folk", "kick"),
          hat: getGrooveDrumVelocityMultiplier("folk", "hat"),
          openHat: getGrooveDrumVelocityMultiplier("folk", "openHat"),
          snare: getGrooveDrumVelocityMultiplier("folk", "snare"),
          clap: getGrooveDrumVelocityMultiplier("folk", "clap")
        });
      }
      if (styleName === "pianoPop") {
        console.log("[PageSynth Mix] pianoPop drum cut:", {
          kick: getGrooveDrumVelocityMultiplier("pianoPop", "kick"),
          hat: getGrooveDrumVelocityMultiplier("pianoPop", "hat"),
          openHat: getGrooveDrumVelocityMultiplier("pianoPop", "openHat"),
          snare: getGrooveDrumVelocityMultiplier("pianoPop", "snare"),
          clap: getGrooveDrumVelocityMultiplier("pianoPop", "clap")
        });
      }
      if (styleName === "warm" || styleName === "pianoPop") {
        const bassCut = styleName === "pianoPop" ? 0.28 : 0.26;
        console.log("[PageSynth Mix] rhythm restore:", {
          style: styleName,
          bassCut,
          kick: getGrooveDrumVelocityMultiplier(styleName, "kick"),
          hat: getGrooveDrumVelocityMultiplier(styleName, "hat"),
          openHat: getGrooveDrumVelocityMultiplier(styleName, "openHat"),
          snare: getGrooveDrumVelocityMultiplier(styleName, "snare"),
          clap: getGrooveDrumVelocityMultiplier(styleName, "clap")
        });
      }
      if (["simple", "warm", "calm", "folk", "pianoPop"].includes(styleName)) {
        console.log(`[PageSynth Mix] soft style blip muted: ${styleName}`);
      }
    } else {
      currentMode = "data-driven";
      activeStylePreset = STYLE_PRESETS.warm;
      console.log("[PageSynth Style] style: warm");
      hybridState = {
        enabled: false,
        pageBpmOffset: 0,
        hatMutationRate: 0,
        pitchOffset: 0,
        cutoff: 1200,
        seed: rngSeed,
        bassDebugCounter: 0,
        swing: 0,
        blipRotate: 0,
        bassRotate: 0,
        padBrightness: 1,
        padLengthMul: 1,
        padGainMul: 1,
        selectedGeneratedGrooveByStyle: {}
      };
      musicParams = calculateMusicParams(pageData);
      const textSource = `${pageData.title || ""} ${pageData.bodyText || ""}`;
      melodyNotes = generateMelodyFromText(textSource);
      melodyIndex = 0;
      console.log("[PageSynth Audio] using data-driven mode");
    }

    ensureAudioContext();
    ensureAudioGraph();
    // restore master gain after previous fade-out
    if (audioGraph && activeStylePreset) {
      try {
        const now = audioContext.currentTime;
        audioGraph.masterGain.gain.cancelScheduledValues(now);
        audioGraph.masterGain.gain.setValueAtTime(activeStylePreset.master || MIX.master, now);
      } catch (_) {}
    }
    isStopping = false;
    const ctx = audioContext;
    if (!ctx || ctx.state === "closed") {
      throw new Error("audio context not available after ensureAudioContext");
    }
    console.log("[PageSynth Audio] start session:", sessionId, "ctx state:", ctx.state);

    await loadDrumSamplesOnce(ctx, sessionId);
    await loadInstrumentSamplesOnce(ctx, sessionId);
    console.log("[PageSynth Audio] after sample load:", {
      sessionId,
      currentSession: audioSessionId,
      ctxState: ctx.state
    });

    if (sessionId !== audioSessionId) {
      console.debug("[PageSynth Audio] start aborted, stale session", {
        sessionId,
        currentSession: audioSessionId,
        ctxState: ctx?.state
      });
      return { ok: true, stale: true, ignored: true };
    }
    if (!ctx || ctx.state === "closed") {
      return { ok: false, error: "audio context closed" };
    }
    const now = ctx.currentTime;
    void now;

    console.log("[PageSynth Audio] sound polish enabled");
    console.log(`[PageSynth Audio] sound style: ${SOUND_STYLE}`);

    isPlaying = true;
    currentStep = 0;
    startScheduler(ctx);

    console.log("[PageSynth Audio] started");
    console.log("[PageSynth] start config", {
      bpm: musicParams.bpm,
      density: musicParams.density,
      pitchOffset: musicParams.pitchOffset,
      cutoff: musicParams.filterCutoff,
      seed: rngSeed,
      melody: melodyNotes.slice(0, 8),
      melodyLength: melodyNotes.length
    });
    return { ok: true };
  } catch (error) {
    console.error("[PageSynth Audio] start failed:", error);
    hardStopAllAudio();
    throw error;
  }
}

/**
 * 停止播放音樂
 */
let isStopping = false;

function hardStopAllAudio() {
  audioSessionId++;
  isPlaying = false;
  isStopping = false;

  scheduledTimeoutIds.forEach((id) => {
    try { clearTimeout(id); } catch (_) {}
  });
  scheduledTimeoutIds = [];

  if (scheduleInterval) {
    clearInterval(scheduleInterval);
    scheduleInterval = null;
  }

  activeNodes.forEach((node) => {
    try { if (typeof node.stop === "function") node.stop(0); } catch (_) {}
    try { node.disconnect(); } catch (_) {}
  });
  activeNodes.clear();

  if (audioContext && audioContext.state !== "closed") {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  audioGraph = null;
  sampleBuffers.clear();
  drumSamplesLoadPromise = null;
  drumSamplesLoadSessionId = null;
  instrumentSampleBuffers.clear();
  instrumentSamplesLoadPromise = null;
  instrumentSamplesLoadSessionId = null;
  loggedSampledBass = false;
  loggedSampledPluck = false;
  loggedBassSoftCut = false;
  loggedKawaiAcousticBass = false;
  loggedManualEmptyKick = false;
  loggedManualEmptyHat = false;
  loggedManualEmptyDrums = false;
  bassV2DebugLogged = false;
  loggedPianoPopHH = false;
  arrangementDebugLogged = false;
  formulaDebugLogged = false;
  formulaPlaybackLogged = false;
  formulaPlaybackSection = null;
  warmBodyLogged = false;
  padArpSampleLogSet.clear();
  padArpFallbackLogSet.clear();
  padArpMultiSampleEnabledLogged = false;
  optionalSampleMissingLogSet.clear();

  currentStep = 0;
  nextStepTime = 0;
  barIndex = 0;
  melodyIndex = 0;

  console.log("[PageSynth Audio] hard stopped");
}

function smoothStopAllAudio() {
  if (isStopping) return;
  if (!audioContext || !audioGraph || audioContext.state === "closed") {
    hardStopAllAudio();
    return;
  }

  isStopping = true;
  isPlaying = false;
  audioSessionId++;

  // kill scheduler immediately — no new notes
  scheduledTimeoutIds.forEach((id) => { try { clearTimeout(id); } catch (_) {} });
  scheduledTimeoutIds = [];
  if (scheduleInterval) {
    clearInterval(scheduleInterval);
    scheduleInterval = null;
  }

  console.log("[PageSynth Ending] smooth stop start");

  // fade master gain to zero
  const now = audioContext.currentTime;
  const fadeDuration = 1.2;
  try {
    const currentGain = activeStylePreset?.master ?? MIX.master;
    audioGraph.masterGain.gain.cancelScheduledValues(now);
    audioGraph.masterGain.gain.setValueAtTime(currentGain, now);
    audioGraph.masterGain.gain.linearRampToValueAtTime(0.0001, now + fadeDuration);
  } catch (_) {}

  // after fade, hard clean
  setTimeout(() => {
    if (isStopping) {
      hardStopAllAudio();
      console.log("[PageSynth Ending] fade-out complete");
    }
  }, (fadeDuration + 0.15) * 1000);
}

function playEndingChord(chord, styleName, time) {
  if (!audioContext || !audioGraph) return;
  const ctx = audioContext;
  let rootMidi = 48, fifthMidi = 55;
  try {
    const parsed = parseChord(chord);
    const rootMap = { C:48, D:50, E:52, F:53, G:55, A:45, B:47 };
    rootMidi = rootMap[parsed.root] || 48;
    fifthMidi = clamp(rootMidi + 7, 43, 62);
  } catch (_) {}

  for (const midi of [rootMidi, fifthMidi]) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    osc.type = "sine";
    lp.type = "lowpass";
    lp.frequency.value = styleName === "pianoPop" ? 1600 : 1000;
    lp.Q.value = 0.35;
    const len = 1.4;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(styleName === "pianoPop" ? 0.07 : 0.05, time + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, time + len);
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(lp);
    lp.connect(gain);
    gain.connect(audioGraph.masterInput);
    osc.start(time);
    osc.stop(time + len + 0.06);
    // not registered in activeNodes — cleared by hardStopAllAudio
  }
}

function stopAllAudio() {
  smoothStopAllAudio();
}

function stopMusic() {
  stopAllAudio();
}
