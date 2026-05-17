/**
 * background.js - PageSynth Background Service Worker
 * 
 * 負責管理 offscreen document 的生命週期，
 * 以及作為 popup 與 offscreen 之間的通訊橋樑。
 * 
 * 通訊流程：
 *   popup → background (chrome.runtime.sendMessage)
 *   background → offscreen (chrome.runtime.sendMessage)
 *   offscreen → background (chrome.runtime.sendMessage)
 */

// 記錄 offscreen document 是否已建立
let offscreenCreated = false;

// 播放狀態（給 popup 查詢）
let playbackState = {
  isPlaying: false,
  tabId: null,
  url: null,
  startedAt: null
};

let offscreenAvailable = false;
let liveCodeConfig = null;

function clearPlaybackState() {
  playbackState = {
    isPlaying: false,
    tabId: null,
    url: null,
    startedAt: null
  };
}

/**
 * 監聽來自 popup 或 offscreen 的訊息
 * 
 * 重要：只有當 handler 是 async 且需要回傳結果給呼叫端時，
 * 才 return true 並確保 sendResponse 被呼叫。
 * 同步操作直接 return false（或不 return true）。
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request?.action;

  switch (action) {
    case "startMusic":
      handleStartMusic(request)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
      return true;

    case "stopMusic":
      handleStopMusic()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
      return true;

    case "GET_PLAYBACK_STATE":
      console.log("[PageSynth BG] GET_PLAYBACK_STATE quick response", playbackState);
      sendResponse({
        ok: true,
        playbackState: { ...playbackState },
        isPlaying: playbackState.isPlaying === true
      });
      return false;

    case "offscreenReady":
    case "OFFSCREEN_READY":
      try {
        offscreenCreated = true;
        offscreenAvailable = true;
        sendResponse({ ok: true, ready: true });
      } catch (error) {
        sendResponse({ ok: false, error: String(error.message || error) });
      }
      return true;

    case "SET_LIVE_CODE_CONFIG":
      (async () => {
        try {
          liveCodeConfig = request?.config || null;
          await ensureOffscreenReady();
          const res = await sendMessageSafe({
            action: "SET_LIVE_CODE_CONFIG",
            config: liveCodeConfig
          });
          sendResponse(res.ok ? { ok: true } : res);
        } catch (error) {
          sendResponse({ ok: false, error: String(error.message || error) });
        }
      })();
      return true;

    case "GET_LIVE_CODE_CONFIG":
      try {
        sendResponse({ ok: true, config: liveCodeConfig });
      } catch (error) {
        sendResponse({ ok: false, error: String(error.message || error) });
      }
      return true;

    default:
      return false;
  }
});

/**
 * 安全發送訊息，統一處理 chrome.runtime.lastError
 * @param {Object} message
 * @returns {Promise<Object>}
 */
function sendMessageSafe(message, options = {}) {
  const ignoreReceivingEndMissing = Boolean(options.ignoreReceivingEndMissing);
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const errMsg = String(chrome.runtime.lastError.message || "");
          const isReceivingMissing = errMsg.includes("Could not establish connection")
            || errMsg.includes("Receiving end does not exist")
            || errMsg.includes("message channel closed");

          if (ignoreReceivingEndMissing && isReceivingMissing) {
            resolve({ ok: true, ignored: true, reason: "receiving_end_missing" });
            return;
          }
          reject(new Error(errMsg));
          return;
        }
        if (!response) {
          reject(new Error("Empty response"));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 處理開始音樂的請求
 * 1. 確保 offscreen document 已建立
 * 2. 將網頁資料轉發到 offscreen
 * @param {Object} request - 訊息內容
 * @returns {Promise<Object>} { ok: true } 或 { ok: false, error: ... }
 */
async function handleStartMusic(request) {
  try {
    const pageData = request?.pageData;
    const tabId = request?.tabId ?? null;
    const url = request?.url || pageData?.url || null;
    const mode = request?.mode === "pageData" ? "pageData" : "hybrid";

    if (!pageData) {
      return { ok: false, error: "Missing pageData" };
    }

    // 先全面停止，避免殘留音源
    await handleStopMusic({ silent: true });

    await ensureOffscreenReady();

    // optimistic: 先更新播放狀態，讓 popup 可立即同步到 isPlaying=true
    playbackState = {
      isPlaying: true,
      tabId,
      url,
      startedAt: Date.now()
    };
    console.log("[PageSynth BG] playback state set optimistic");
    offscreenAvailable = true;

    const offscreenResult = await sendMessageSafe({
      action: "START_MUSIC",
      pageData: pageData,
      liveCodeConfig,
      mode
    });

    if (offscreenResult?.stale === true) {
      console.log("[PageSynth BG] stale start ignored");
      return { ok: true, stale: true, ignored: true, playbackState, isPlaying: true };
    }

    if (!offscreenResult.ok) {
      if (offscreenResult?.stale === true) {
        console.log("[PageSynth BG] stale start ignored");
        return { ok: true, stale: true, ignored: true, playbackState, isPlaying: true };
      }
      if (offscreenResult?.timeout === true) {
        console.log("[PageSynth BG] start timeout, keep optimistic playback state");
        return { ok: true, timeout: true, assumedPlaying: true, playbackState, isPlaying: true };
      }
      // 真正失敗才清狀態
      clearPlaybackState();
      offscreenAvailable = false;
      return offscreenResult;
    }

    console.log("[PageSynth BG] playback started");

    return { ok: true, playbackState, isPlaying: true };
  } catch (error) {
    const errMsg = String(error.message || error);
    if (errMsg.includes("message timeout")) {
      console.log("[PageSynth BG] start timeout in exception path, keep optimistic playback state");
      return { ok: true, timeout: true, assumedPlaying: true, playbackState, isPlaying: true };
    }

    offscreenAvailable = false;
    clearPlaybackState();
    console.log("[PageSynth BG] start failed, state cleared");
    console.error("Start music failed:", error);
    if (
      errMsg.includes("Could not establish connection")
      || errMsg.includes("Receiving end does not exist")
      || errMsg.includes("message channel closed")
      || errMsg.includes("offscreen not ready")
    ) {
      return { ok: false, error: "offscreen not ready or missing" };
    }
    return { ok: false, error: errMsg };
  }
}

/**
 * 處理停止音樂的請求
 * @returns {Promise<Object>} { ok: true }
 */
async function handleStopMusic(options = {}) {
  try {
    let reason;
    let offscreenResult = { ok: true };

    try {
      await ensureOffscreen();
      offscreenResult = await sendMessageSafe(
        { action: "STOP_MUSIC" },
        { ignoreReceivingEndMissing: true }
      );
      if (offscreenResult.reason === "receiving_end_missing") {
        reason = "offscreen_missing";
        offscreenAvailable = false;
        console.log("[PageSynth BG] offscreen missing, treated as stopped");
      }
    } catch (error) {
      const errMsg = String(error.message || error);
      if (
        errMsg.includes("Could not establish connection")
        || errMsg.includes("Receiving end does not exist")
        || errMsg.includes("message channel closed")
      ) {
        reason = "offscreen_missing";
        offscreenAvailable = false;
        console.log("[PageSynth BG] offscreen missing, treated as stopped");
      } else {
        throw error;
      }
    }

    clearPlaybackState();

    if (!options.silent) {
      console.log("[PageSynth BG] playback stopped");
    }

    if (reason) {
      return { ok: true, stopped: true, reason, playbackState: { ...playbackState }, isPlaying: false };
    }
    return {
      ok: true,
      stopped: true,
      ignored: offscreenResult.ignored === true,
      playbackState: { ...playbackState },
      isPlaying: false
    };
  } catch (error) {
    clearPlaybackState();
    console.error("Stop music failed:", error);
    return { ok: false, error: String(error.message || error) };
  }
}

async function waitForOffscreenReady(timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await sendMessageSafe(
        { action: "PING_OFFSCREEN" },
        { ignoreReceivingEndMissing: true }
      );
      if (res.ok && res.ready) {
        offscreenAvailable = true;
        console.log("[PageSynth BG] offscreen ready");
        return;
      }
    } catch (_) {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log("[PageSynth BG] offscreen ready timeout");
  throw new Error("offscreen not ready");
}

async function ensureOffscreenReady() {
  console.log("[PageSynth BG] ensuring offscreen ready");
  let hasDoc = false;
  if (chrome.offscreen && typeof chrome.offscreen.hasDocument === "function") {
    hasDoc = await chrome.offscreen.hasDocument();
  } else {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    hasDoc = contexts.length > 0;
  }

  if (!hasDoc) {
    console.log("[PageSynth BG] creating offscreen document");
    await chrome.offscreen.createDocument({
      url: "src/offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play generative audio from web page data"
    });
  }

  offscreenCreated = true;
  await waitForOffscreenReady(2000);
}

/**
 * 確保 offscreen document 已建立
 * 如果尚未建立，則建立一個新的 offscreen document
 */
async function ensureOffscreen() {
  if (offscreenCreated) {
    return;
  }

  try {
    // 檢查是否已有 offscreen document
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });

    if (existingContexts.length > 0) {
      offscreenCreated = true;
      return;
    }

    // 建立 offscreen document
    await chrome.offscreen.createDocument({
      url: "src/offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Use Web Audio API to play music"
    });

    offscreenCreated = true;
  } catch (error) {
    console.error("Create offscreen document failed:", error);
    throw error;
  }
}

/**
 * 當 service worker 啟動時，檢查並清理 offscreen document
 */
chrome.runtime.onStartup.addListener(() => {
  offscreenCreated = false;
  offscreenAvailable = false;
  clearPlaybackState();
});

// 關閉播放來源分頁時自動停止
chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    if (playbackState.isPlaying && playbackState.tabId === tabId) {
      console.log("[PageSynth BG] source tab removed, auto stop");
      handleStopMusic();
    }
  } catch (error) {
    console.error("onRemoved auto-stop failed:", error);
  }
});

// 播放中的分頁發生 reload/navigation 時自動停止
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  try {
    if (!playbackState.isPlaying || playbackState.tabId !== tabId) {
      return;
    }
    const urlChanged = typeof changeInfo.url === "string" && changeInfo.url !== playbackState.url;
    const reloading = changeInfo.status === "loading";
    if (reloading && (urlChanged || playbackState.url)) {
      console.log("[PageSynth BG] source tab navigated/reloaded, auto stop");
      handleStopMusic();
      offscreenAvailable = false;
    }
  } catch (error) {
    console.error("onUpdated auto-stop failed:", error);
  }
});

chrome.tabs.onActivated.addListener(() => {
  console.log("[PageSynth BG] tab activated, no stop");
});
