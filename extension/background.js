'use strict';

// Clicking the toolbar icon opens the FoldLab side panel.
function enablePanelOnClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function (e) {
    console.error('FoldLab: could not set side panel behavior', e);
  });
}
chrome.runtime.onInstalled.addListener(enablePanelOnClick);
chrome.runtime.onStartup.addListener(enablePanelOnClick);

// Opens the multi-device playground in a new tab.
// Sites often forbid being framed (X-Frame-Options / frame-ancestors). For this one tab only,
// we strip those headers from sub-frame responses so any page can be shown inside the playground.
async function openPlayground(url, view) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tab.id],
    addRules: [
      {
        id: tab.id,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'x-frame-options', operation: 'remove' },
            { header: 'content-security-policy', operation: 'remove' },
            { header: 'content-security-policy-report-only', operation: 'remove' }
          ]
        },
        condition: { tabIds: [tab.id], resourceTypes: ['sub_frame'] }
      }
    ]
  });
  const hash = new URLSearchParams();
  if (url) hash.set('u', url);
  if (view) hash.set('v', view);
  await chrome.tabs.update(tab.id, {
    url: chrome.runtime.getURL('playground/web/index.html') + '#' + hash.toString()
  });
}

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (msg && msg.type === 'foldlab:open-playground') {
    openPlayground(msg.url, msg.view).then(
      function () { sendResponse({ ok: true }); },
      function (e) { sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }); }
    );
    return true; // keep the channel open for the async response
  }
  return false;
});

// Remove the header-stripping rule when the playground tab closes.
chrome.tabs.onRemoved.addListener(function (tabId) {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }).catch(function () {});
});
