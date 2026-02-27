// Service worker: icon click handler + CORS proxy

chrome.action.onClicked.addListener((tab) => {
  if (tab.id && !tab.url?.startsWith('chrome://')) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE' })
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SAFE_FETCH') {
    handleSafeFetch(message.url, message.returnBase64)
      .then(data => sendResponse({ type: 'SAFE_FETCH_RESULT', requestId: message.requestId, data }))
      .catch(err => sendResponse({ type: 'SAFE_FETCH_RESULT', requestId: message.requestId, error: err.message }))
    return true // keep channel open for async response
  }

  if (message.type === 'DOWNLOAD_FONT') {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename,
    })
  }
})

async function handleSafeFetch(url: string, returnBase64: boolean): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (returnBase64) {
    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }
  return response.text()
}
