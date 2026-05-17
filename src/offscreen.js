/**
 * offscreen.js - PageSynth Recovery Core
 *
 * Minimal rebuild after v1.5 patch corruption.
 * Supports: warm, pianoPop styles with formula library.
 */
// ============================================
// Web Audio Variables
// ============================================
let audioContext = null;
let isPlaying = false;
let scheduleInterval = null;
let nextStepTime = 0;
let currentStep = 0;
let barIndex = 0;
let scheduledTimeoutIds = [];
let activeNodes = new Set();
let musicParams = { bpm: 120, density: 0.5, pitchOffset: 0, filterCutoff: 1000 };
let stepData = { kick: [], hat: [], snare: [], clap: [], bass: [], blip: [], padChords: [] };
let melodyNotes = [];
let melodyIndex = 0;
let rngSeed = 1;
let currentLiveCodeConfig = null;
let currentMode = "data-driven";
let hybridState = {
  enabled: false, pageBpmOffset: 0, hatMutationRate: 0,
  pitchOffset: 0, cutoff: 1200, seed: 1,
  bassDebugCounter: 0, swing: 0, blipRotate: 0, bassRotate: 0,
  mutationScale: 0, padBrightness: 1, padLengthMul: 1, padGainMul: 1,
  selectedPhraseByStyle: {}, selectedGeneratedGrooveByStyle: {}
};
const MIX = {
  master: 0.72, kickSample: 0.76, hatSample: 0.21,
  snareSample: 0.42, clapSample: 0.36,
  kick: 0.9, hat: 0.24, bass: 0.39, blip: 0.32, pad: 0.28,
  reverbSend: 0.1, delaySend: 0.12, padReverbSend: 0.18
};
const SAMPLE_PATHS = {
  kick: "assets/samples/kick.wav", hat: "assets/samples/hat.wav",
  snare: "assets/samples/snare.wav", clap: "assets/samples/clap.wav"
};
const INSTRUMENT_SAMPLE_PATHS = {
  casioPianoC4: "assets/samples/instruments/Casio-Piano-C4.wav",
  nylonGuitarC3: "assets/samples/instruments/nylon_guitar_C3.wav",
  nylonGuitarC4: "assets/samples/instruments/nylon_guitar_C4.wav",
  softPianoC4: "assets/samples/instruments/soft_piano_C4.wav",
  kawaiAcousticBassC2: "assets/samples/instruments/Kawai-K1r-Acoustic-Bass-C2.wav"
};
const OPTIONAL_INSTRUMENT_SAMPLES = new Set([
  "kawaiAcousticBassC2","softPianoC4","nylonGuitarC4","nylonGuitarC3"
]);
let activeStylePreset = null;
let audioSessionId = 0;
let audioGraph = null;
let sampleBuffers = new Map();
let drumSamplesLoadPromise = null;
let drumSamplesLoadSessionId = null;
let instrumentSampleBuffers = new Map();
let instrumentSamplesLoadPromise = null;
let instrumentSamplesLoadSessionId = null;
let loggedPianoPopHH = false;
let arrangementDebugLogged = false;
let warmBodyLogged = false;
let formulaDebugLogged = false;
let formulaPlaybackLogged = false;
let formulaPlaybackSection = null;
let isStopping = false;
let optionalSampleMissingLogSet = new Set();
let padArpSampleLogSet = new Set();
let padArpFallbackLogSet = new Set();
let padArpMultiSampleEnabledLogged = false;
let samplerCache = null;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function midiToNoteName(m) {
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  return names[m % 12] + Math.floor(m / 12 - 1);
}
function getDeterministicSeedFromPageData(pd) {
  const s = (pd?.title || "") + (pd?.url || "") + String(pd?.wordCount || 0);
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return Math.abs(h || 1);
}
function mixSeed(a, b) { return Math.abs((a * 31 + b * 17 + 7) | 0) || 1; }
function pickBySeed(seed, list) { return list[Math.abs(seed) % list.length]; }

const STYLE_PRESETS = {
  warm: { master:0.72, kick:0.38, hat:0.26, openHat:0.22, bass:0.42, blip:0.32, pad:0.34, saturation:0.55, reverb:0.28, delay:0.15, cutoffBias:0.78, mutation:0.25, swing:0.018, density:0.44 },
  pianoPop: { master:0.72, kick:0.38, hat:0.26, openHat:0.22, bass:0.42, blip:0.32, pad:0.34, saturation:0.55, reverb:0.28, delay:0.15, cutoffBias:0.78, mutation:0.25, swing:0.018, density:0.44 }
};

const PIANO_ARP_FORMULAS = {
  flow_basic: { name:"Flow Basic", bars:4, patterns:[
    { bar:0, roles:["root","fifth","third","fifth","octaveRoot","fifth","third","fifth"], offsets:[0,2,4,6,8,10,12,14] },
    { bar:1, roles:["root","fifth","third","fifth","root","fifth","third"], offsets:[0,2,4,6,8,10,14] },
    { bar:2, roles:["root","fifth","third","fifth","root","fifth","third","fifth","root"], offsets:[0,2,4,6,8,9,10,12,14] },
    { bar:3, roles:["root","fifth","third","fifth","root","fifth"], offsets:[0,2,4,6,10,14] }
  ]},
  ballad_rolling: { name:"Ballad Rolling", bars:4, patterns:[
    { bar:0, roles:["root","fifth","octaveRoot","fifth","third","fifth","octaveRoot","fifth"], offsets:[0,2,4,6,8,10,12,14] },
    { bar:1, roles:["root","fifth","octaveRoot","fifth","third","fifth","octaveRoot","fifth"], offsets:[0,2,4,6,8,10,12,14] },
    { bar:2, roles:["root","fifth","octaveRoot","fifth","third","fifth","octaveRoot","fifth"], offsets:[0,2,4,6,8,10,12,14] },
    { bar:3, roles:["root","fifth","octaveRoot","fifth"], offsets:[0,3,7,14] }
  ]},
  broken_up: { name:"Broken Up", bars:4, patterns:[
    { bar:0, roles:["root","third","fifth","octaveRoot","root","third","fifth","octaveRoot"], offsets:[0,2,4,6,8,10,12,14] },
    { bar:1, roles:["root","third","fifth","octaveRoot","root","third","fifth","octaveRoot"], offsets:[0,2,4,6,8,10,12,14] },
    { bar:2, roles:["root","third","fifth","octaveRoot","root","third","fifth"], offsets:[0,2,4,6,8,10,14] },
    { bar:3, roles:["root","fifth","octaveRoot"], offsets:[0,6,14] }
  ]},
  question_answer: { name:"Question Answer", bars:4, patterns:[
    { bar:0, roles:["root","fifth","root"], offsets:[0,4,12] },
    { bar:1, roles:["root","fifth","third","fifth","root"], offsets:[0,2,4,8,14] },
    { bar:2, roles:["root","fifth","third","fifth","octaveRoot","fifth","third"], offsets:[0,2,4,6,8,10,14] },
    { bar:3, roles:["root","fifth","root"], offsets:[0,6,14] }
  ]},
  soft_sparse: { name:"Soft Sparse", bars:4, patterns:[
    { bar:0, roles:["root","fifth","root"], offsets:[0,4,12] },
    { bar:1, roles:["root","fifth","root"], offsets:[0,4,12] },
    { bar:2, roles:["root","fifth","root"], offsets:[0,6,14] },
    { bar:3, roles:["root","fifth","root"], offsets:[0,6,14] }
  ]}
};
const BASS_FORMULAS = {
  root_pulse: { name:"Root Pulse", steps:[0,4,12], velocityMul:1.0, role:"root" },
  simple_root: { name:"Simple Root", steps:[0,8], velocityMul:1.0, role:"root" },
  sparse_root: { name:"Sparse Root", steps:[0], velocityMul:1.0, role:"root" },
  four_pulse: { name:"Four Pulse", steps:[0,4,8,12], velocityMul:0.7, role:"root" }
};
const HH_FORMULAS = {
  off: { name:"Off", steps:[], pattern:"----------------", closedOnly:true },
  soft_pulse: { name:"Soft Pulse", steps:[0,4,8,12], pattern:"x---x---x---x---", closedOnly:true },
  flow: { name:"Flow", steps:[0,1,3,5,7,8,9,11,13,15], pattern:"xx-x-x-xxx-x-x-x", closedOnly:true },
  story: { name:"Story", steps:[0,4,6,8,12,14], pattern:"x---x-x-x---x-x-", closedOnly:true },
  motion: { name:"Motion", steps:[0,1,4,5,8,9,10,11,12,13,14,15], pattern:"xx-xx-xxxx-xx-xx", closedOnly:true }
};
const SECTION_FORMULAS = {
  intro: { arp:"soft_sparse", bass:"off", hh:"off" },
  main: { arp:"flow_basic", bass:"root_pulse", hh:"flow" },
  variation: { arp:["ballad_rolling","broken_up"], bass:"root_pulse", hh:["flow","motion"] },
  breakSec: { arp:"soft_sparse", bass:"off", hh:"off" },
  returnSec: { arp:"flow_basic", bass:"root_pulse", hh:"flow" }
};

function getPianoPopSectionFormula(variant, section, seed) {
  const pickOne = (arr) => arr[Math.abs(seed) % arr.length];
  const map = {
    flow: {
      intro:{ arp:"soft_sparse", bass:"off", hh:"off" },
      main:{ arp:"flow_basic", bass:"root_pulse", hh:"flow" },
      variation:{ arp:["ballad_rolling","broken_up"], bass:"root_pulse", hh:["flow","motion"] },
      break:{ arp:"soft_sparse", bass:"off", hh:"off" },
      return:{ arp:"flow_basic", bass:"root_pulse", hh:"flow" }
    },
    soft: {
      intro:{ arp:"soft_sparse", bass:"off", hh:"off" },
      main:{ arp:["soft_sparse","question_answer"], bass:["sparse_root","root_pulse"], hh:"off" },
      variation:{ arp:"question_answer", bass:"sparse_root", hh:"off" },
      break:{ arp:"soft_sparse", bass:"off", hh:"off" },
      return:{ arp:"soft_sparse", bass:"sparse_root", hh:"off" }
    },
    story: {
      intro:{ arp:"soft_sparse", bass:"off", hh:"off" },
      main:{ arp:"ballad_rolling", bass:"root_pulse", hh:"story" },
      variation:{ arp:"question_answer", bass:["sparse_root","root_pulse"], hh:["story","flow"] },
      break:{ arp:"soft_sparse", bass:"off", hh:"off" },
      return:{ arp:"ballad_rolling", bass:"root_pulse", hh:"story" }
    },
    motion: {
      intro:{ arp:["flow_basic","soft_sparse"], bass:"sparse_root", hh:"off" },
      main:{ arp:"broken_up", bass:"root_pulse", hh:["motion","flow"] },
      variation:{ arp:["broken_up","flow_basic"], bass:["root_pulse","four_pulse"], hh:"motion" },
      break:{ arp:"soft_sparse", bass:"off", hh:"off" },
      return:{ arp:"broken_up", bass:"root_pulse", hh:"motion" }
    }
  };
  const group = (map[variant]||map.flow)[section]||map.flow.main;
  const arp = Array.isArray(group.arp)?pickOne(group.arp):group.arp;
  const bass = Array.isArray(group.bass)?pickOne(group.bass):group.bass;
  const hh = Array.isArray(group.hh)?pickOne(group.hh):group.hh;
  return { arpFormulaKey:arp, bassFormulaKey:bass, hhFormulaKey:hh,
    arpFormula:PIANO_ARP_FORMULAS[arp]||null,
    bassFormula:BASS_FORMULAS[bass]||null,
    hhFormula:HH_FORMULAS[hh]||null };
}

function getArrangementSection(barIndex) {
  const s = (barIndex % 32 + 32) % 32;
  if (s < 4) return "intro";
  if (s < 12) return "main";
  if (s < 20) return "variation";
  if (s < 24) return "break";
  return "return";
}

function registerNode(node) {
  if (node && typeof node === "object") activeNodes.add(node);
}

function createVoiceOutput(opts, gainVal) {
  if (!audioContext || !audioGraph) return null;
  const ctx = audioContext;
  const gain = ctx.createGain();
  gain.gain.value = clamp(Number(gainVal||0.3), 0.0001, 2);
  registerNode(gain);
  try {
    const rv = ctx.createGain();
    rv.gain.value = clamp(Number(opts?.reverb||0), 0, 1);
    registerNode(rv);
    const dl = ctx.createGain();
    dl.gain.value = clamp(Number(opts?.delay||0), 0, 1);
    registerNode(dl);
    gain.connect(audioGraph.masterInput);
    if (opts?.reverb > 0.001) { gain.connect(rv); rv.connect(audioGraph.reverbSend); }
    if (opts?.delay > 0.001) { gain.connect(dl); dl.connect(audioGraph.delaySend); }
    return gain;
  } catch (_) { return gain; }
}

function ensureAudioContext() {
  if (audioContext && audioContext.state !== "closed") return;
  try {
    audioContext = new AudioContext({ sampleRate: 44100 });
    if (audioContext.state === "suspended") audioContext.resume();
    activeNodes.clear();
  } catch (e) {
    console.error("[PageSynth] AudioContext creation failed:", e);
    audioContext = null;
  }
}

function ensureAudioGraph() {
  if (!audioContext || audioContext.state === "closed") return;
  if (audioGraph) return;
  const ctx = audioContext;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18; compressor.knee.value = 8; compressor.ratio.value = 3;
  compressor.attack.value = 0.005; compressor.release.value = 0.15;
  const masterInput = ctx.createGain(); masterInput.gain.value = 0.8;
  const reverbSend = ctx.createConvolver();
  const reverbWet = ctx.createGain(); reverbWet.gain.value = 0.15;
  const reverbBuffer = ctx.createBuffer(2, ctx.sampleRate * 1.5, ctx.sampleRate);
  try {
    for (let ch = 0; ch < 2; ch++) {
      const d = reverbBuffer.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.35));
      }
    }
  } catch (_) {}
  reverbSend.buffer = reverbBuffer;
  const delaySend = ctx.createDelay(1.0); delaySend.delayTime.value = 0.25;
  const delayWet = ctx.createGain(); delayWet.gain.value = 0.2;
  const masterGain = ctx.createGain();
  masterGain.gain.value = activeStylePreset?.master ?? MIX.master;
  masterInput.connect(compressor); compressor.connect(masterGain); masterGain.connect(ctx.destination);
  reverbSend.connect(reverbWet); reverbWet.connect(masterGain);
  delaySend.connect(delayWet); delayWet.connect(masterGain);
  audioGraph = { masterInput, reverbSend, delaySend, masterGain };
}

async function loadSampleBuffer(ctx, path) {
  try {
    const url = chrome.runtime.getURL(path);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("fetch failed");
    const ab = await resp.arrayBuffer();
    return await ctx.decodeAudioData(ab);
  } catch (e) {
    console.warn("[PageSynth] sample load failed:", path, e.message);
    return null;
  }
}

async function loadInstrumentSamplesOnce(ctx, sessionId) {
  if (instrumentSamplesLoadPromise && instrumentSamplesLoadSessionId === sessionId)
    return instrumentSamplesLoadPromise;
  instrumentSamplesLoadSessionId = sessionId;
  instrumentSamplesLoadPromise = (async () => {
    for (const [key, path] of Object.entries(INSTRUMENT_SAMPLE_PATHS)) {
      if (instrumentSampleBuffers.has(key)) continue;
      const buf = await loadSampleBuffer(ctx, path);
      if (buf) instrumentSampleBuffers.set(key, buf);
    }
  })();
  return instrumentSamplesLoadPromise;
}

async function loadDrumSamplesOnce(ctx, sessionId) {
  if (drumSamplesLoadPromise && drumSamplesLoadSessionId === sessionId)
    return drumSamplesLoadPromise;
  drumSamplesLoadSessionId = sessionId;
  drumSamplesLoadPromise = (async () => {
    for (const [key, path] of Object.entries(SAMPLE_PATHS)) {
      if (sampleBuffers.has(key)) continue;
      const buf = await loadSampleBuffer(ctx, path);
      if (buf) sampleBuffers.set(key, buf);
    }
  })();
  return drumSamplesLoadPromise;
}

function getSafePadVoicing(chord, styleName) {
  const rootMap = { C:48, D:50, E:52, F:53, G:55, A:45, B:47 };
  const isMinor = chord.includes("m") && !chord.includes("maj");
  let rootName = chord.replace("m","").replace(/[0-9]/g,"").trim();
  if (!rootMap[rootName]) return [{ role:"root", midi:48 }, { role:"fifth", midi:55 }];
  let root = rootMap[rootName];
  let third = root + (isMinor ? 3 : 4);
  let fifth = root + 7;
  let octaveRoot = root + 12;
  return [
    { role:"root", midi: clamp(root, 45, 60) },
    { role:"third", midi: clamp(third, 50, 63) },
    { role:"fifth", midi: clamp(fifth, 50, 64) },
    { role:"octaveRoot", midi: clamp(octaveRoot, 57, 65) }
  ];
}

function getPadArpSampleName(styleName, barIndex) {
  if (styleName === "pianoPop") return "casioPianoC4";
  if (styleName === "warm") return "nylonGuitarC3";
  return "softPianoC4";
}

function getPadArpFallbackSamples(styleName) {
  if (styleName === "pianoPop") return ["softPianoC4","nylonGuitarC4"];
  if (styleName === "warm") return ["nylonGuitarC4","softPianoC4"];
  return ["softPianoC4"];
}

function playPadArpSampleNote(s, midi, role, time, noteLen, styleName) {
  if (!audioContext || !audioGraph) return false;
  const sampleName = s.source || s.sample || getPadArpSampleName(styleName, 0);
  const fallbackSamples = getPadArpFallbackSamples(styleName);
  let sample = instrumentSampleBuffers.get(sampleName);
  if (!sample) {
    for (const fb of fallbackSamples) {
      sample = instrumentSampleBuffers.get(fb);
      if (sample) break;
    }
  }
  const style = activeStylePreset || STYLE_PRESETS.warm;
  const rg = { root:1.0, fifth:0.85, third:0.55, octaveRoot:0.75 };
  const peak = clamp(0.22 * (rg[role]||0.7) * (styleName==="pianoPop"?1.25:1), 0.08, 0.30);
  const attack = styleName === "warm" ? 0.024 : (styleName === "pianoPop" ? 0.008 : 0.012);
  const release = styleName === "warm"
    ? clamp(noteLen * 0.88, 0.42, 0.72)
    : (styleName === "pianoPop" ? clamp(noteLen * 0.95, 0.40, 0.80) : clamp(noteLen * 0.92, 0.35, 0.75));
  const reverb = styleName === "warm" ? (0.08 + style.reverb * 0.11)
    : (styleName === "pianoPop" ? (0.10 + style.reverb * 0.14) : (0.06 + style.reverb * 0.08));

  if (!sample) {
    // synth fallback
    const ctx = audioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    const out = createVoiceOutput({ reverb, delay:0.0 }, MIX.pad * style.pad * peak);
    if (!out) { osc.disconnect(); return false; }
    registerNode(osc);
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    osc.type = styleName === "pianoPop" ? "triangle" : "sine";
    lp.type = "lowpass";
    if (styleName === "warm") { lp.frequency.setValueAtTime(clamp(musicParams.filterCutoff*0.70,1500,2400),time); lp.Q.value=0.48; }
    else if (styleName === "pianoPop") { lp.frequency.setValueAtTime(clamp(musicParams.filterCutoff*0.82,2000,3400),time); lp.Q.value=0.55; }
    else { lp.frequency.setValueAtTime(clamp(musicParams.filterCutoff*0.75,1400,2400),time); lp.Q.value=0.55; }
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + attack);
    gain.gain.exponentialRampToValueAtTime(peak*0.32, time + Math.max(0.35, noteLen*0.52));
    gain.gain.exponentialRampToValueAtTime(0.0012, time + release);
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(lp); lp.connect(gain); gain.connect(out);
    osc.start(time); osc.stop(time + release + 0.06);
    return true;
  }
  // sample playback
  const ctx = audioContext;
  const source = ctx.createBufferSource();
  const lp = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const out = createVoiceOutput({ reverb, delay:0.0 }, MIX.pad * style.pad * peak);
  if (!out) { source.disconnect(); return false; }
  registerNode(source);
  const origMidi = sampleName === "casioPianoC4" ? 60 : (sampleName.includes("Guitar") ? 48 : 60);
  const playbackRate = Math.pow(2, (midi - origMidi) / 12);
  source.buffer = sample;
  source.playbackRate.setValueAtTime(playbackRate, time);
  lp.type = "lowpass";
  if (styleName === "warm") { lp.frequency.setValueAtTime(clamp(musicParams.filterCutoff*0.70,1500,2400),time); lp.Q.value=0.48; }
  else if (styleName === "pianoPop") { lp.frequency.setValueAtTime(clamp(musicParams.filterCutoff*0.82,2000,3400),time); lp.Q.value=0.55; }
  else { lp.frequency.setValueAtTime(clamp(musicParams.filterCutoff*0.75,1400,2400),time); lp.Q.value=0.55; }
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(peak, time + attack);
  gain.gain.exponentialRampToValueAtTime(peak*0.25, time + release*0.6);
  gain.gain.exponentialRampToValueAtTime(0.001, time + release);
  source.connect(lp); lp.connect(gain); gain.connect(out);
  source.start(time); source.stop(time + release + 0.06);
  return true;
}

function playPadArpeggio(chord, time, stepDuration, styleName) {
  if (!audioContext || !audioGraph || !chord) return;
  let tones;
  try { tones = getSafePadVoicing(chord, styleName); } catch (_) { return; }
  const style = activeStylePreset || STYLE_PRESETS.warm;
  const roleMap = {};
  for (const t of tones) roleMap[t.role] = t.midi;
  const root = clamp(roleMap.root ?? 48, 45, 60);
  const fifth = clamp(roleMap.fifth ?? (root + 7), 50, 64);
  const third = clamp(roleMap.third ?? (root + 3), 50, 63);
  const octaveRoot = clamp(roleMap.octaveRoot ?? (root + 12), 57, 65);
  const safe = { root, fifth, third, octaveRoot };

  let seqRoles = ["root","fifth","third","fifth"];
  let stepOffsets = [0,3,8,11];
  let arpNoteCount = 4;
  const phraseBar = barIndex % 4;
  const roleGain = { root:1.0, fifth:0.85, third:0.55, octaveRoot:0.75 };

  if (styleName === "warm") {
    seqRoles = ["root","fifth","third","fifth"];
    stepOffsets = [0,3,8,11];
    arpNoteCount = 4;
  } else if (styleName === "pianoPop") {
    const variant = (() => {
      const cfg = currentLiveCodeConfig;
      if (!cfg) return "flow";
      const h = (cfg.hat || cfg._hat || "");
      if (h === "----------------") return "soft";
      if (h.includes("xx-x-x-xxx")) return "motion";
      return "flow";
    })();
    const section = getArrangementSection(barIndex);
    const formula = getPianoPopSectionFormula(variant, section, hybridState.seed + barIndex);
    const arpF = formula.arpFormula;
    if (arpF && arpF.patterns) {
      const barIn4 = barIndex % 4;
      const pat = arpF.patterns[barIn4] || arpF.patterns[0];
      if (pat) { seqRoles = pat.roles; stepOffsets = pat.offsets; arpNoteCount = pat.roles.length; }
    }
    if (!formulaPlaybackLogged || formulaPlaybackSection !== section) {
      formulaPlaybackLogged = true; formulaPlaybackSection = section;
      console.log("[PageSynth Formula] arp:", formula.arpFormulaKey, "section:", section);
    }
  }

  const sampleName = getPadArpSampleName(styleName, barIndex);
  for (let i = 0; i < arpNoteCount; i++) {
    const role = seqRoles[i % seqRoles.length];
    let midi = clamp(safe[role] ?? root, 48, 65);
    const noteTime = time + stepOffsets[i] * stepDuration;
    const noteLen = clamp(stepDuration * 2 * 0.92, 0.34, 0.9);
    playPadArpSampleNote({ source: sampleName }, midi, role, noteTime, noteLen, styleName);
  }
}

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
    const out = createVoiceOutput({ reverb:0.02+style.reverb*0.06, delay:0.0 }, MIX.pad*style.pad*0.12);
    if (!out) { osc.disconnect(); return; }
    registerNode(osc);
    osc.type = "sine";
    lp.type = "lowpass"; lp.frequency.value = clamp(musicParams.filterCutoff*0.45, 900, 1400); lp.Q.value = 0.4;
    const len = clamp(musicParams.bpm ? (240/musicParams.bpm) : 2.5, 1.5, 3.5);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.06, time + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.02, time + len*0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, time + len);
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(lp); lp.connect(gain); gain.connect(out);
    osc.start(time); osc.stop(time + len + 0.06);
  }
}

function playBassV2Note(midi, time, dur, styleName) {
  if (!audioContext || !audioGraph) return;
  const ctx = audioContext;
  const style = activeStylePreset || STYLE_PRESETS.warm;
  const isSynthBass = styleName === "pianoPop" || styleName === "warm";
  const safeMidi = isSynthBass ? clamp(midi, 45, 59) : clamp(midi, 45, 52);
  const freq = 440 * Math.pow(2, (safeMidi - 69) / 12);
  const osc = ctx.createOscillator();
  const subOsc = ctx.createOscillator();
  const lp = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const out = createVoiceOutput({ reverb:0.02+style.reverb*0.04, delay:0.0 },
    MIX.bass*style.bass*(isSynthBass?(styleName==="pianoPop"?0.46:0.40):0.38));
  if (!out) { osc.disconnect(); subOsc.disconnect(); return; }
  registerNode(osc); registerNode(subOsc);
  osc.type = "sine"; subOsc.type = "triangle";
  lp.type = "lowpass"; lp.frequency.setValueAtTime(clamp(freq*2.5,300,900),time); lp.Q.value=0.5;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(1.0, time+0.04);
  gain.gain.exponentialRampToValueAtTime(0.35, time+dur*0.55);
  gain.gain.exponentialRampToValueAtTime(0.001, time+dur);
  osc.frequency.setValueAtTime(freq, time);
  subOsc.frequency.setValueAtTime(freq*0.5, time);
  osc.connect(lp); subOsc.connect(lp); lp.connect(gain); gain.connect(out);
  osc.start(time); osc.stop(time+dur+0.05);
  subOsc.start(time); subOsc.stop(time+dur+0.05);
}

function parseChord(chord) {
  const m = String(chord).trim().match(/^([A-G][#b]?)(m?)/i);
  if (!m) return { root:"A", minor:false };
  return { root: m[1], minor: m[2] === "m" };
}

function normalizeStyle(config) {
  const raw = config?.style ?? config?._style ?? config?.styleName ?? config?._styleName ?? "warm";
  const s = String(raw || "warm").toLowerCase().trim();
  if (s === "pianopop") return "pianoPop";
  if (s === "warm") return "warm";
  return "warm";
}

function normalizeChordList(config) {
  const raw = config?.chords ?? config?._chords ?? "Am F C G";
  if (Array.isArray(raw)) {
    return raw.map((c) => String(c || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.trim().split(/\s+/).filter(Boolean);
  }
  return ["Am", "F", "C", "G"];
}

function buildHybridStepData(config, pageData, state) {
  const styleName = normalizeStyle(config);
  const bpm = Number(config.bpm || config._bpm || 96);
  const padChords = normalizeChordList(config);
  if (padChords.length === 0) padChords.push("Am", "F", "C", "G");
  const chordsRaw = padChords.join(" ");
  const kickRaw = String(config?.kick ?? config?._kick ?? "----------------").trim();
  const hatRaw = String(config?.hat ?? config?._hat ?? "----------------").trim();
  const kick = new Array(16).fill(false);
  const hat = new Array(16).fill(false);
  for (let i = 0; i < 16; i++) {
    if (kickRaw[i] && kickRaw[i] !== "-") kick[i] = true;
    if (hatRaw[i] && hatRaw[i] !== "-") hat[i] = true;
  }
  musicParams.bpm = clamp(Number(bpm)||96, 60, 160);
  musicParams.filterCutoff = clamp(Number(pageData?.filterCutoff||1200), 500, 7000);
  return { kick, hat, snare:new Array(16).fill(false), clap:new Array(16).fill(false),
    bass:new Array(16).fill(null), blip:new Array(16).fill(null), padChords, styleName, bpm,
    manualEmptyKick: kickRaw.replace(/-/g,"").trim().length===0,
    manualEmptyHat: hatRaw.replace(/-/g,"").trim().length===0, chordsRaw };
}

function scheduleStep(stepDuration) {
  if (!audioContext || !audioGraph || !isPlaying) return;
  const styleName = stepData.styleName || "warm";
  const section = getArrangementSection(barIndex);
  const isArranged = styleName === "warm" || styleName === "pianoPop";
  const sectionMuteBass = isArranged && (section === "intro" || section === "break");
  const sectionMuteHH = isArranged && (styleName === "pianoPop" ? (section === "intro" || section === "break") : true);

  if (!arrangementDebugLogged) {
    arrangementDebugLogged = true;
    console.log("[PageSynth Arrangement] section:", section, "style:", styleName);
  }

  const timeOffset = stepDuration * currentStep;
  const time = audioContext.currentTime + 0.05 + timeOffset;

  // pad chord bar
  if (currentStep === 0) {
    const padChords = stepData.padChords || [];
    if (padChords.length > 0) {
      const padChord = padChords[barIndex % padChords.length];
      playPadArpeggio(padChord, time, stepDuration, styleName);
      if (styleName === "warm") { playWarmBodyLayer(padChord, time); }
      console.log("[PageSynth Music] pad chord bar:", barIndex + 1, padChord);
    }
  }

  // Bass V2 scheduling
  if (!sectionMuteBass && currentStep === 0) {
    const padChords = stepData.padChords || [];
    if (padChords.length > 0) {
      const chord = padChords[barIndex % padChords.length];
      const rootMap = { C:48, D:50, E:52, F:53, G:55, A:45, B:47 };
      let rootName = chord.replace("m","").replace(/[0-9]/g,"").trim();
      let rootMidi = rootMap[rootName] || 45;
      if ((styleName === "pianoPop" || styleName === "warm") && rootName === "G") rootMidi = 47;
      rootMidi = clamp(rootMidi, 43, 62);
      let bassSteps = styleName === "pianoPop" ? [0,4,12] : [0,8];
      if (styleName === "pianoPop") {
        try {
          const variant = (() => {
            const cfg = currentLiveCodeConfig;
            if (!cfg) return "flow";
            const h = (cfg.hat || cfg._hat || "");
            if (h === "----------------") return "soft";
            if (h.includes("xx-x-x-xxx")) return "motion";
            return "flow";
          })();
          const formula = getPianoPopSectionFormula(variant, section, hybridState.seed + barIndex);
          const bassF = formula.bassFormula;
          if (bassF && bassF.steps && bassF.steps.length > 0) bassSteps = bassF.steps;
        } catch (_) {}
      }
      for (const s of bassSteps) {
        const bassTime = time + s * stepDuration;
        playBassV2Note(rootMidi, bassTime, stepDuration * 0.62, styleName);
      }
    }
  }

  // Hi-hat for pianoPop
  if (styleName === "pianoPop" && !sectionMuteHH) {
    const hatRaw = (currentLiveCodeConfig?.hat || currentLiveCodeConfig?._hat || "x---x---x---x---").trim();
    const manualEmptyHat = hatRaw.replace(/-/g,"").trim().length === 0;
    if (!manualEmptyHat) {
      let hatSteps = [0,1,3,5,7,8,9,11,13,15];
      let velStrong = 0.36, velSoft = 0.28;
      try {
        const variant = (() => {
          const cfg = currentLiveCodeConfig;
          if (!cfg) return "flow";
          const h = (cfg.hat || cfg._hat || "");
          if (h === "----------------") return "soft";
          if (h.includes("xx-x-x-xxx")) return "motion";
          return "flow";
        })();
        const formula = getPianoPopSectionFormula(variant, section, hybridState.seed + barIndex);
        const hhF = formula.hhFormula;
        if (hhF && hhF.steps && hhF.steps.length > 0) {
          hatSteps = hhF.steps;
          if (variant === "motion") { velStrong = 0.24; velSoft = 0.18; }
        }
      } catch (_) {}
      for (const s of hatSteps) {
        if (!stepData.hat[s]) {
          const ctx = audioContext;
          const noise = ctx.createBufferSource();
          const buf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          noise.buffer = buf;
          const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 8500; bp.Q.value = 0.7;
          const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 5000;
          const gain = ctx.createGain();
          const vel = (s === 0 || s === 8) ? velStrong : velSoft;
          const hhDur = 0.045;
          gain.gain.setValueAtTime(vel * MIX.hatSample * 0.5, time + s * stepDuration);
          gain.gain.exponentialRampToValueAtTime(0.001, time + s * stepDuration + hhDur);
          noise.connect(bp); bp.connect(hp); hp.connect(gain); gain.connect(audioGraph.masterInput);
          noise.start(time + s * stepDuration); noise.stop(time + s * stepDuration + hhDur + 0.01);
          registerNode(noise);
        }
      }
    }
  }

  currentStep++;
  if (currentStep >= 16) { currentStep = 0; barIndex++; }
}

function startScheduler(ctx) {
  if (scheduleInterval) clearInterval(scheduleInterval);
  nextStepTime = ctx.currentTime + 0.1;
  currentStep = 0;
  barIndex = 0;
  const stepDuration = 60 / Math.max(40, Math.min(200, musicParams.bpm)) / 4;
  scheduleStep(stepDuration);
  scheduleInterval = setInterval(() => {
    if (!isPlaying) return;
    const sd = 60 / Math.max(40, Math.min(200, musicParams.bpm)) / 4;
    scheduleStep(sd);
  }, stepDuration * 1000);
}

async function startMusic(pageData) {
  let sessionId = 0;
  try {
    hardStopAllAudio();
    sessionId = ++audioSessionId;
    ensureAudioContext();
    ensureAudioGraph();
    if (audioGraph && activeStylePreset) {
      try {
        const now = audioContext.currentTime;
        audioGraph.masterGain.gain.cancelScheduledValues(now);
        audioGraph.masterGain.gain.setValueAtTime(activeStylePreset.master || MIX.master, now);
      } catch (_) {}
    }
    isStopping = false;
    const ctx = audioContext;
    if (!ctx || ctx.state === "closed") { throw new Error("audio context not available"); }
    await loadDrumSamplesOnce(ctx, sessionId);
    await loadInstrumentSamplesOnce(ctx, sessionId);
    if (sessionId !== audioSessionId) { return { stale: true }; }

    const config = currentLiveCodeConfig;
    const styleName = normalizeStyle(config);
    console.log("[PageSynth Debug] start config style:", styleName, "raw:", config?.style, config?._style, config?.styleName);
    const effectiveStyle = (styleName === "warm" || styleName === "pianoPop") ? styleName : "warm";
    activeStylePreset = STYLE_PRESETS[effectiveStyle] || STYLE_PRESETS.warm;
    hybridState = { enabled:false, pageBpmOffset:0, hatMutationRate:0, pitchOffset:0, cutoff:1200, seed:rngSeed,
      bassDebugCounter:0, swing:0, blipRotate:0, bassRotate:0, mutationScale:0,
      padBrightness:1, padLengthMul:1, padGainMul:1,
      selectedPhraseByStyle:{}, selectedGeneratedGrooveByStyle:{} };
    musicParams = { bpm: Number(config?.bpm||config?._bpm||96), density:0.44, pitchOffset:0,
      filterCutoff: clamp(Number(pageData?.filterCutoff||1200), 500, 7000) };
    stepData = buildHybridStepData(config||{}, pageData||{}, hybridState);
    stepData.styleName = effectiveStyle;
    isPlaying = true;
    startScheduler(ctx);
    console.log("[PageSynth] started — style:", effectiveStyle);
    return { ok: true, isPlaying: true };
  } catch (error) {
    console.error("[PageSynth] start failed:", error);
    hardStopAllAudio();
    throw error;
  }
}

function hardStopAllAudio() {
  audioSessionId++; isPlaying = false; isStopping = false;
  scheduledTimeoutIds.forEach((id) => { try { clearTimeout(id); } catch (_) {} }); scheduledTimeoutIds = [];
  if (scheduleInterval) { clearInterval(scheduleInterval); scheduleInterval = null; }
  activeNodes.forEach((node) => {
    try { if (typeof node.stop === "function") node.stop(0); } catch (_) {}
    try { node.disconnect(); } catch (_) {}
  }); activeNodes.clear();
  if (audioContext && audioContext.state !== "closed") { audioContext.close().catch(()=>{}); audioContext = null; }
  audioGraph = null; sampleBuffers.clear(); drumSamplesLoadPromise = null; drumSamplesLoadSessionId = null;
  instrumentSampleBuffers.clear(); instrumentSamplesLoadPromise = null; instrumentSamplesLoadSessionId = null;
  loggedPianoPopHH = false; arrangementDebugLogged = false; formulaDebugLogged = false;
  formulaPlaybackLogged = false; formulaPlaybackSection = null; warmBodyLogged = false;
  padArpSampleLogSet.clear(); padArpFallbackLogSet.clear(); padArpMultiSampleEnabledLogged = false;
  optionalSampleMissingLogSet.clear(); samplerCache = null;
  currentStep = 0; nextStepTime = 0; barIndex = 0; melodyIndex = 0;
  console.log("[PageSynth] hard stopped");
}

function smoothStopAllAudio() {
  if (isStopping) return;
  if (!audioContext || !audioGraph || audioContext.state === "closed") { hardStopAllAudio(); return; }
  isStopping = true; isPlaying = false; audioSessionId++;
  scheduledTimeoutIds.forEach((id) => { try { clearTimeout(id); } catch (_) {} }); scheduledTimeoutIds = [];
  if (scheduleInterval) { clearInterval(scheduleInterval); scheduleInterval = null; }
  console.log("[PageSynth Ending] smooth stop start");
  const now = audioContext.currentTime; const fadeDuration = 1.2;
  try {
    const currentGain = activeStylePreset?.master ?? MIX.master;
    audioGraph.masterGain.gain.cancelScheduledValues(now);
    audioGraph.masterGain.gain.setValueAtTime(currentGain, now);
    audioGraph.masterGain.gain.linearRampToValueAtTime(0.0001, now + fadeDuration);
  } catch (_) {}
  setTimeout(() => { if (isStopping) { hardStopAllAudio(); console.log("[PageSynth Ending] fade-out complete"); } }, (fadeDuration+0.15)*1000);
}

function stopAllAudio() { smoothStopAllAudio(); }
function stopMusic() { stopAllAudio(); }

// ============================================
// Chrome Runtime Message Listener
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;
  switch (request.action) {
    case "startMusic": case "START_MUSIC":
      (async () => {
        try {
          if (!request.pageData) { sendResponse({ ok:false, error:"Missing pageData" }); return; }
          if (request.liveCodeConfig) currentLiveCodeConfig = request.liveCodeConfig;
          const result = await startMusic(request.pageData);
          if (result?.stale) { sendResponse({ ok:true, stale:true, ignored:true }); return; }
          sendResponse({ ok:true, isPlaying:true });
        } catch (e) { sendResponse({ ok:false, error:String(e.message||e) }); }
      })();
      return true;
    case "stopMusic": case "STOP_MUSIC":
      try { stopAllAudio(); sendResponse({ ok:true, stopped:true }); } catch (e) { sendResponse({ ok:false, error:String(e.message||e) }); }
      return true;
    case "PING_OFFSCREEN":
      sendResponse({ ok:true, ready:true, isPlaying }); return false;
    case "GET_PLAYBACK_STATE":
      sendResponse({ ok:true, playbackState:{ isPlaying, isStopping } }); return false;
    case "SET_LIVE_CODE_CONFIG":
      try { currentLiveCodeConfig = request.config||null; sendResponse({ ok:true }); } catch (e) { sendResponse({ ok:false, error:String(e.message||e) }); }
      return false;
    default: return false;
  }
});
