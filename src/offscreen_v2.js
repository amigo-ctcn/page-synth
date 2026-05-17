/**
 * offscreen_v2.js - PageSynth v2 pianoPop-only minimal audio core
 *
 * Clean rebuild. Supports pianoPop only. All synth oscillators, no samples.
 */
// ============================================
// State
// ============================================
let audioContext = null;
let audioGraph = null;
let isPlaying = false;
let isStopping = false;
let activeNodes = new Set();
let scheduleInterval = null;
let currentStep = 0;
let barIndex = 0;
let currentConfig = null;
let musicBpm = 96;
let musicCutoff = 3000;
let chordList = ["Am","F","C","G"];
let recoveryLogged = false;
let sectionLogged = null;

// ============================================
// Utilities
// ============================================
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

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

function getVoicingMidi(chord, role) {
  const parsed = String(chord).trim().match(/^([A-G])(m?)/i);
  if (!parsed) return 60;
  const rootMap = { C:48, D:50, E:52, F:53, G:55, A:45, B:47 };
  const root = rootMap[parsed[1]] || 48;
  const minor = parsed[2] === "m";
  const third = root + (minor ? 3 : 4);
  const fifth = root + 7;
  const octRoot = root + 12;
  switch (role) {
    case "root": return clamp(root, 45, 60);
    case "third": return clamp(third, 50, 63);
    case "fifth": return clamp(fifth, 50, 64);
    case "octaveRoot": return clamp(octRoot, 57, 65);
    default: return root;
  }
}

function getBassMidi(chord) {
  const parsed = String(chord).trim().match(/^([A-G])(m?)/i);
  if (!parsed) return 45;
  const rootName = parsed[1];
  const minor = parsed[2] === "m";
  // G chord → B2 for bass line colour
  if (rootName === "G") return 47;
  const rootMap = { C:48, D:50, E:52, F:53, G:47, A:45, B:47 };
  return rootMap[rootName] || 45;
}

function normalizeChords(config) {
  const raw = config?.chords ?? config?._chords ?? "Am F C G";
  if (Array.isArray(raw)) return raw.map(c => String(c||"").trim()).filter(Boolean);
  if (typeof raw === "string") return raw.trim().split(/\s+/).filter(Boolean);
  return ["Am","F","C","G"];
}

// ============================================
// Audio Graph
// ============================================
function ensureAudioContext() {
  if (audioContext && audioContext.state !== "closed") return;
  try {
    audioContext = new AudioContext({ sampleRate: 44100 });
    if (audioContext.state === "suspended") audioContext.resume();
  } catch (e) {
    console.error("[PageSynth v2] AudioContext failed:", e);
    audioContext = null;
  }
}

function ensureAudioGraph() {
  if (!audioContext || audioContext.state === "closed") return;
  if (audioGraph) return;
  const ctx = audioContext;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 3;
  comp.attack.value = 0.003; comp.release.value = 0.2;
  const input = ctx.createGain(); input.gain.value = 0.7;
  const masterGain = ctx.createGain(); masterGain.gain.value = 0.72;
  input.connect(comp); comp.connect(masterGain); masterGain.connect(ctx.destination);
  audioGraph = { input, masterGain };
}

// ============================================
// Synth Voices
// ============================================
function playPianoNote(midi, time, dur) {
  if (!audioContext || !audioGraph) return;
  const ctx = audioContext;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  const freq = midiToFreq(midi);
  osc.type = "triangle";
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(clamp(musicCutoff * 0.82, 2000, 3400), time);
  lp.Q.value = 0.55;
  const attack = 0.008;
  const peak = 0.22;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(peak, time + attack);
  gain.gain.exponentialRampToValueAtTime(peak * 0.32, time + dur * 0.50);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.frequency.setValueAtTime(freq, time);
  osc.connect(lp); lp.connect(gain); gain.connect(audioGraph.input);
  osc.start(time); osc.stop(time + dur + 0.06);
  registerNode(osc);
}

function playBassNote(midi, time, dur) {
  if (!audioContext || !audioGraph) return;
  const ctx = audioContext;
  const osc = ctx.createOscillator();
  const sub = ctx.createOscillator();
  const lp = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const freq = midiToFreq(midi);
  osc.type = "sine";
  sub.type = "triangle";
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(clamp(freq * 2.5, 300, 900), time);
  lp.Q.value = 0.5;
  const attack = 0.035;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.18, time + attack);
  gain.gain.exponentialRampToValueAtTime(0.06, time + dur * 0.55);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.frequency.setValueAtTime(freq, time);
  sub.frequency.setValueAtTime(freq * 0.5, time);
  osc.connect(lp); sub.connect(lp); lp.connect(gain); gain.connect(audioGraph.input);
  osc.start(time); osc.stop(time + dur + 0.05);
  sub.start(time); sub.stop(time + dur + 0.05);
  registerNode(osc); registerNode(sub);
}

function playHiHat(time, velocity) {
  if (!audioContext || !audioGraph) return;
  const ctx = audioContext;
  const noise = ctx.createBufferSource();
  const bufSize = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noise.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 9000; bp.Q.value = 0.6;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 5000;
  const gain = ctx.createGain();
  const dur = 0.045;
  const vel = clamp(velocity, 0.02, 0.6);
  gain.gain.setValueAtTime(vel, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  noise.connect(bp); bp.connect(hp); hp.connect(gain); gain.connect(audioGraph.input);
  noise.start(time); noise.stop(time + dur + 0.01);
  registerNode(noise);
}

// ============================================
// Piano Arpeggio
// ============================================
function playPianoArp(chord, time, stepDuration) {
  const roles = ["root","fifth","third","fifth","octaveRoot","fifth","third","fifth"];
  const offsets = [0, 2, 4, 6, 8, 10, 12, 14];
  const roleGain = { root:1.0, fifth:0.85, third:0.55, octaveRoot:0.75 };
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const midi = getVoicingMidi(chord, role);
    const t = time + offsets[i] * stepDuration;
    const dur = clamp(stepDuration * 2 * 0.9, 0.34, 0.85);
    playPianoNote(midi, t, dur);
  }
}

// ============================================
// Schedule
// ============================================
function scheduleBar(stepDuration) {
  if (!audioContext || !audioGraph || !isPlaying) return;
  const section = getArrangementSection(barIndex);
  const muteBassHH = section === "intro" || section === "break";
  const time = audioContext.currentTime + 0.05;

  // section log
  if (sectionLogged !== section) {
    sectionLogged = section;
    console.log("[PageSynth v2] section:", section);
  }

  // piano arp always plays
  const chord = chordList[barIndex % chordList.length];
  playPianoArp(chord, time, stepDuration);

  // bass: only main/variation/return
  if (!muteBassHH) {
    const bassMidi = getBassMidi(chord);
    const bassSteps = [0, 4, 12];
    for (const s of bassSteps) {
      playBassNote(bassMidi, time + s * stepDuration, stepDuration * 0.55);
    }
  }

  // hi-hat: only main/variation/return, and only if hat not all "-"
  const hatRaw = String(currentConfig?.hat ?? currentConfig?._hat ?? "x---x---x---x---").trim();
  const hatEmpty = hatRaw.replace(/-/g,"").trim().length === 0;
  if (!muteBassHH && !hatEmpty) {
    const hhSteps = [0,1,3,5,7,8,9,11,13,15];
    for (const s of hhSteps) {
      const vel = (s === 0 || s === 8) ? 0.28 : 0.20;
      playHiHat(time + s * stepDuration, vel);
    }
  }

  barIndex++;
}

function startScheduler() {
  if (scheduleInterval) clearInterval(scheduleInterval);
  barIndex = 0;
  const barDuration = 60 / clamp(musicBpm, 60, 160) * 4;
  scheduleBar(barDuration / 16);

  scheduleInterval = setInterval(() => {
    if (!isPlaying) return;
    const bd = 60 / clamp(musicBpm, 60, 160) * 4;
    scheduleBar(bd / 16);
  }, barDuration * 1000);
}

// ============================================
// Start
// ============================================
function startMusic(config) {
  hardStopAllAudio();
  ensureAudioContext();
  ensureAudioGraph();
  if (!audioContext || audioContext.state === "closed") {
    throw new Error("AudioContext not available");
  }
  isStopping = false;
  currentConfig = config || {};

  // normalize
  musicBpm = clamp(Number(currentConfig?.bpm ?? currentConfig?._bpm ?? 96), 60, 160);
  chordList = normalizeChords(currentConfig);
  if (chordList.length === 0) chordList = ["Am","F","C","G"];

  console.log("[PageSynth v2] start config:", {
    bpm: musicBpm,
    chords: chordList.join(" "),
    hat: String(currentConfig?.hat ?? currentConfig?._hat ?? "x---x---x---x---"),
    style: "pianoPop"
  });

  isPlaying = true;
  startScheduler();
  return { ok: true, isPlaying: true };
}

// ============================================
// Stop
// ============================================
function hardStopAllAudio() {
  isPlaying = false;
  isStopping = false;
  if (scheduleInterval) { clearInterval(scheduleInterval); scheduleInterval = null; }
  activeNodes.forEach(n => {
    try { if (typeof n.stop === "function") n.stop(0); } catch (_) {}
    try { n.disconnect(); } catch (_) {}
  });
  activeNodes.clear();
  if (audioContext && audioContext.state !== "closed") {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  audioGraph = null;
  sectionLogged = null;
  recoveryLogged = false;
  console.log("[PageSynth v2] hard stopped");
}

function smoothStopAllAudio() {
  if (isStopping) return;
  if (!audioContext || !audioGraph || audioContext.state === "closed") {
    hardStopAllAudio();
    return;
  }
  isStopping = true;
  isPlaying = false;
  if (scheduleInterval) { clearInterval(scheduleInterval); scheduleInterval = null; }
  console.log("[PageSynth v2] smooth stop start");
  const now = audioContext.currentTime;
  const fadeDuration = 1.2;
  try {
    audioGraph.masterGain.gain.cancelScheduledValues(now);
    audioGraph.masterGain.gain.setValueAtTime(0.72, now);
    audioGraph.masterGain.gain.linearRampToValueAtTime(0.0001, now + fadeDuration);
  } catch (_) {}
  setTimeout(() => {
    if (isStopping) { hardStopAllAudio(); console.log("[PageSynth v2] fade-out complete"); }
  }, (fadeDuration + 0.15) * 1000);
}

function stopAllAudio() { smoothStopAllAudio(); }
function stopMusic() { stopAllAudio(); }

// ============================================
// Message Listener
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;
  switch (request.action) {
    case "startMusic": case "START_MUSIC":
      (async () => {
        try {
          if (!request.pageData) { sendResponse({ ok:false, error:"Missing pageData" }); return; }
          if (request.liveCodeConfig) currentConfig = request.liveCodeConfig;
          const result = startMusic(currentConfig);
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
      try { currentConfig = request.config||null; sendResponse({ ok:true }); } catch (e) { sendResponse({ ok:false, error:String(e.message||e) }); }
      return false;
    default: return false;
  }
});

console.log("[PageSynth v2] ready");
