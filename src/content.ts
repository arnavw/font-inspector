// Content script: message relay between background service worker and page world scripts

let injected = false
let visible = false
let container: HTMLDivElement | null = null

// Handle TOGGLE from background service worker (icon click)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TOGGLE') {
    if (!injected) {
      inject()
    }
    toggle()
    sendResponse({ ok: true })
  }
  return true
})

function inject() {
  if (window.self !== window.top) return // skip iframes

  // Inject page-world scripts (font detection + UI)
  const pageScript = document.createElement('script')
  pageScript.src = chrome.runtime.getURL('page.js')
  pageScript.id = 'font-inspector-page'
  document.documentElement.appendChild(pageScript)

  const uiScript = document.createElement('script')
  uiScript.src = chrome.runtime.getURL('ui.js')
  uiScript.id = 'font-inspector-ui'
  document.documentElement.appendChild(uiScript)

  // Create UI container
  container = document.createElement('div')
  container.id = 'font-inspector'
  container.style.display = 'none'
  document.body.appendChild(container)

  injected = true
}

function toggle() {
  visible = !visible
  if (container) {
    container.style.display = visible ? 'block' : 'none'
  }
  // Notify page world scripts of visibility change
  window.postMessage({ type: 'FI_TOGGLE', visible }, '*')
}

// Relay SAFE_FETCH from page world -> background -> page world
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return

  if (event.data.type === 'SAFE_FETCH') {
    chrome.runtime.sendMessage(
      { type: 'SAFE_FETCH', url: event.data.url, returnBase64: event.data.returnBase64, requestId: event.data.requestId },
      (response) => {
        if (chrome.runtime.lastError) {
          window.postMessage({ type: 'SAFE_FETCH_RESULT', requestId: event.data.requestId, error: chrome.runtime.lastError.message }, '*')
          return
        }
        window.postMessage(response, '*')
      }
    )
  }

  if (event.data.type === 'DOWNLOAD_FONT') {
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_FONT', url: event.data.url, filename: event.data.filename })
  }
})
