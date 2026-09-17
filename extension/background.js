// RecruitSage Background Service Worker (Manifest V3)

chrome.runtime.onInstalled.addListener(() => {
  console.log("[RecruitSage] Extension installed successfully.");
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "OPEN_SIDEPANEL") {
    if (sender.tab && sender.tab.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id }).catch((err) => {
        console.error("[RecruitSage] Failed to open side panel:", err);
      });
      sendResponse({ status: "ok" });
    }
  }
});
