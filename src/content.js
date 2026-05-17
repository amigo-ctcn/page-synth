/**
 * content.js - PageSynth Content Script
 * 
 * 負責擷取目前網頁的資料，供 popup 和 offscreen 使用。
 * 透過 chrome.runtime.onMessage 監聽來自 popup 的請求。
 */

// 監聽來自 extension 其他部分的訊息請求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzePage") {
    // 收集網頁統計資料
    const pageData = collectPageData();
    sendResponse(pageData);
  }
  // 回傳 true 表示會非同步回覆
  return true;
});

/**
 * 收集目前網頁的各項統計資料
 * @returns {Object} 包含網頁各項統計資料的物件
 */
function collectPageData() {
  // 取得網頁純文字內容
  const textContent = document.body?.innerText || "";

  // 計算字數（以空白分隔的單詞數量）
  const words = textContent.trim()
    ? textContent.trim().split(/\s+/).length
    : 0;

  // 計算字元數（不含空白）
  const chars = textContent.replace(/\s/g, "").length;

  // 計算 DOM 元素總數
  const domCount = document.querySelectorAll("*").length;

  // 計算連結總數
  const linkCount = document.querySelectorAll("a").length;

  // 計算圖片總數
  const imageCount = document.querySelectorAll("img").length;

  return {
    title: document.title || "(無標題)",
    url: location.href || "",
    wordCount: words,
    charCount: chars,
    domCount: domCount,
    linkCount: linkCount,
    imageCount: imageCount
  };
}
