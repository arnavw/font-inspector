// UI: Tooltip + Font List Panel — vanilla TypeScript, no framework

import { rgbaToHex } from './utils'
import type { DetectedFont, ElementStyle, TooltipData } from './types'

// ---- State ----

let isActive = false
let fonts: DetectedFont[] = []
let panel: HTMLDivElement | null = null
let tooltip: HTMLDivElement | null = null
let hoveredElement: HTMLElement | null = null
let currentTooltipData: TooltipData | null = null

// ---- Styles ----

const STYLES = `
#fi-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  height: 100vh;
  background: #1a1a1a;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  box-shadow: -2px 0 12px rgba(0,0,0,0.3);
  transition: transform 0.2s ease;
}
#fi-panel.fi-hidden { transform: translateX(100%); }
.fi-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}
.fi-header-title {
  font-weight: 600;
  font-size: 14px;
  color: #fff;
}
.fi-header-count {
  color: #888;
  font-size: 12px;
}
.fi-close {
  background: none;
  border: none;
  color: #888;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.fi-close:hover { color: #fff; }
.fi-list {
  overflow-y: auto;
  flex: 1;
  padding: 8px 0;
}
.fi-font {
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid #2a2a2a;
  transition: background 0.15s;
}
.fi-font:hover { background: #252525; }
.fi-font-name {
  font-size: 16px;
  color: #fff;
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fi-font-meta {
  font-size: 11px;
  color: #777;
  display: flex;
  gap: 8px;
  align-items: center;
}
.fi-badge {
  background: #333;
  color: #aaa;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  text-transform: uppercase;
}
.fi-badge-binary { background: #1a3a2a; color: #6fcf97; }
.fi-badge-variable { background: #2a2a3a; color: #9b8aff; }
.fi-copied {
  position: fixed;
  bottom: 20px;
  right: 340px;
  background: #333;
  color: #6fcf97;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  z-index: 2147483647;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}
.fi-copied.fi-show { opacity: 1; }

#fi-tooltip {
  position: fixed;
  background: #1a1a1a;
  color: #e0e0e0;
  padding: 10px 14px;
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
  z-index: 2147483647;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  max-width: 320px;
  line-height: 1.5;
}
.fi-tooltip-name {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 4px;
}
.fi-tooltip-props {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  font-size: 11px;
}
.fi-tooltip-label { color: #888; }
.fi-tooltip-value { color: #ccc; }
.fi-tooltip-color {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: middle;
}

font-inspector-text.fi-text-hover {
  outline: 2px solid rgba(66, 133, 244, 0.6);
  outline-offset: 1px;
  border-radius: 2px;
  background: rgba(66, 133, 244, 0.08);
}

[data-font-inspector].fi-highlight {
  outline: 2px solid rgba(66, 133, 244, 0.5) !important;
  outline-offset: 1px;
  background: rgba(66, 133, 244, 0.06) !important;
}

.fi-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: #666;
}
.fi-font-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.fi-font-info { flex: 1; min-width: 0; }
.fi-download {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
  margin-top: 2px;
}
.fi-download:hover { color: #fff; background: #333; }
.fi-font.fi-upgraded { animation: fi-flash 0.3s ease; }
@keyframes fi-flash { from { background: #2a3a2a; } to { background: transparent; } }
`

// ---- Init ----

function injectStyles() {
  if (document.getElementById('fi-styles')) return
  const style = document.createElement('style')
  style.id = 'fi-styles'
  style.textContent = STYLES
  document.head.appendChild(style)
}

function createPanel(): HTMLDivElement {
  const el = document.createElement('div')
  el.id = 'fi-panel'
  el.classList.add('fi-hidden')
  el.innerHTML = `
    <div class="fi-header">
      <span class="fi-header-title">Font Inspector</span>
      <span class="fi-header-count" id="fi-count"></span>
      <button class="fi-close" id="fi-close">&times;</button>
    </div>
    <div class="fi-list" id="fi-list"></div>
  `
  document.body.appendChild(el)

  el.querySelector('#fi-close')!.addEventListener('click', () => {
    deactivate()
    window.postMessage({ type: 'FI_TOGGLE', visible: false }, '*')
  })

  // Stop panel events from reaching page
  el.addEventListener('mouseover', e => e.stopPropagation())
  el.addEventListener('mouseout', e => e.stopPropagation())

  return el
}

function createTooltip(): HTMLDivElement {
  const el = document.createElement('div')
  el.id = 'fi-tooltip'
  el.style.display = 'none'
  document.body.appendChild(el)
  return el
}

// ---- Panel rendering ----

function renderFontList() {
  const list = document.getElementById('fi-list')
  const count = document.getElementById('fi-count')
  if (!list || !count) return

  count.textContent = `${fonts.length} font${fonts.length !== 1 ? 's' : ''}`

  if (fonts.length === 0) {
    list.innerHTML = '<div class="fi-loading">No fonts detected</div>'
    return
  }

  list.innerHTML = ''
  for (const font of fonts) {
    const item = document.createElement('div')
    item.className = 'fi-font'
    item.dataset.fontId = font.id

    // Render font name in its own typeface if we have a FontFace for it
    const nameStyle = font.fontFaceSrc
      ? `font-family: '${font.id}', sans-serif; font-weight: ${font.weightNum}; font-style: ${font.style};`
      : ''

    let badges = ''
    if (font.source === 'binary') badges += '<span class="fi-badge fi-badge-binary">parsed</span>'
    if (font.variable) badges += '<span class="fi-badge fi-badge-variable">variable</span>'

    const showDownload = font.fontFaceSrc && !font.fontFaceSrc.startsWith('data:')
    const downloadBtn = showDownload
      ? `<button class="fi-download" title="Download font file">&#8595;</button>`
      : ''

    item.innerHTML = `
      <div class="fi-font-row">
        <div class="fi-font-info">
          <div class="fi-font-name" style="${nameStyle}">${escapeHtml(font.family)}</div>
          <div class="fi-font-meta">
            <span>${font.weight} ${font.weightNum} ${font.style !== 'normal' ? font.style : ''}</span>
            ${badges}
          </div>
        </div>
        ${downloadBtn}
      </div>
    `

    // Download button click
    if (showDownload) {
      item.querySelector('.fi-download')!.addEventListener('click', (e) => {
        e.stopPropagation()
        window.postMessage({
          type: 'DOWNLOAD_FONT',
          url: font.fontFaceSrc,
          filename: buildFontFilename(font),
        }, '*')
      })
    }

    // Hover: highlight matching elements on page
    item.addEventListener('mouseenter', () => {
      document.querySelectorAll(`[data-font-inspector="${font.id}"]`).forEach(el => {
        el.classList.add('fi-highlight')
      })
    })
    item.addEventListener('mouseleave', () => {
      document.querySelectorAll('.fi-highlight').forEach(el => {
        el.classList.remove('fi-highlight')
      })
    })

    // Click: copy CSS to clipboard
    item.addEventListener('click', () => {
      const css = `font-family: ${font.cssFamily};\nfont-weight: ${font.weightNum};\nfont-style: ${font.style};`
      navigator.clipboard.writeText(css).then(() => showCopied())
    })

    list.appendChild(item)
  }
}

function handleFontUpgraded(font: DetectedFont) {
  // Update in fonts array
  const idx = fonts.findIndex(f => f.id === font.id)
  if (idx !== -1) {
    fonts[idx] = font
  } else {
    // New font from CORS sheets
    fonts.push(font)
  }

  // Update count
  const count = document.getElementById('fi-count')
  if (count) count.textContent = `${fonts.length} font${fonts.length !== 1 ? 's' : ''}`

  // Find existing DOM item or create new one
  const list = document.getElementById('fi-list')
  if (!list) return

  let item = list.querySelector(`.fi-font[data-font-id="${font.id}"]`) as HTMLDivElement | null
  const isNew = !item
  if (!item) {
    item = document.createElement('div')
    item.className = 'fi-font'
    item.dataset.fontId = font.id
    list.appendChild(item)
  }

  // Update content
  const nameStyle = font.fontFaceSrc
    ? `font-family: '${font.id}', sans-serif; font-weight: ${font.weightNum}; font-style: ${font.style};`
    : ''

  let badges = ''
  if (font.source === 'binary') badges += '<span class="fi-badge fi-badge-binary">parsed</span>'
  if (font.variable) badges += '<span class="fi-badge fi-badge-variable">variable</span>'

  const showDownload = font.fontFaceSrc && !font.fontFaceSrc.startsWith('data:')
  const downloadBtn = showDownload
    ? `<button class="fi-download" title="Download font file">&#8595;</button>`
    : ''

  item.innerHTML = `
    <div class="fi-font-row">
      <div class="fi-font-info">
        <div class="fi-font-name" style="${nameStyle}">${escapeHtml(font.family)}</div>
        <div class="fi-font-meta">
          <span>${font.weight} ${font.weightNum} ${font.style !== 'normal' ? font.style : ''}</span>
          ${badges}
        </div>
      </div>
      ${downloadBtn}
    </div>
  `

  // Download button click
  if (showDownload) {
    item.querySelector('.fi-download')!.addEventListener('click', (e) => {
      e.stopPropagation()
      window.postMessage({
        type: 'DOWNLOAD_FONT',
        url: font.fontFaceSrc,
        filename: buildFontFilename(font),
      }, '*')
    })
  }

  // Re-bind hover/click events
  item.addEventListener('mouseenter', () => {
    document.querySelectorAll(`[data-font-inspector="${font.id}"]`).forEach(el => {
      el.classList.add('fi-highlight')
    })
  })
  item.addEventListener('mouseleave', () => {
    document.querySelectorAll('.fi-highlight').forEach(el => {
      el.classList.remove('fi-highlight')
    })
  })
  item.addEventListener('click', () => {
    const css = `font-family: ${font.cssFamily};\nfont-weight: ${font.weightNum};\nfont-style: ${font.style};`
    navigator.clipboard.writeText(css).then(() => showCopied())
  })

  // Flash animation
  item.classList.remove('fi-upgraded')
  // Force reflow to restart animation
  void item.offsetWidth
  item.classList.add('fi-upgraded')
}

function showCopied() {
  let toast = document.getElementById('fi-copied') as HTMLDivElement
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'fi-copied'
    toast.className = 'fi-copied'
    toast.textContent = 'CSS copied to clipboard'
    document.body.appendChild(toast)
  }
  toast.classList.add('fi-show')
  setTimeout(() => toast.classList.remove('fi-show'), 1500)
}

// ---- Tooltip ----

function showTooltip(data: TooltipData) {
  if (!tooltip) return
  currentTooltipData = data
  const hex = rgbaToHex(data.style.color)

  tooltip.innerHTML = `
    <div class="fi-tooltip-name">${escapeHtml(data.font.fullName)}</div>
    <div class="fi-tooltip-props">
      <span class="fi-tooltip-label">Size</span>
      <span class="fi-tooltip-value">${data.style.fontSize}</span>
      <span class="fi-tooltip-label">Weight</span>
      <span class="fi-tooltip-value">${data.font.weight} (${data.font.weightNum})</span>
      <span class="fi-tooltip-label">Line Height</span>
      <span class="fi-tooltip-value">${data.style.lineHeight}</span>
      <span class="fi-tooltip-label">Letter Spacing</span>
      <span class="fi-tooltip-value">${data.style.letterSpacing}</span>
      <span class="fi-tooltip-label">Color</span>
      <span class="fi-tooltip-value"><span class="fi-tooltip-color" style="background:${data.style.color}"></span>${hex}</span>
    </div>
  `
  tooltip.style.display = 'block'
}

function hideTooltip() {
  if (tooltip) tooltip.style.display = 'none'
  currentTooltipData = null
}

function positionTooltip(clientX: number, clientY: number) {
  if (!tooltip) return
  const rect = tooltip.getBoundingClientRect()
  let x = clientX - 32
  let y = clientY - rect.height - 15

  if (x < 0) x = 0
  if (x + rect.width + 3 > window.innerWidth) {
    x = window.innerWidth - rect.width - 3
  }
  if (y < 0) y = clientY + 20 // flip below cursor

  tooltip.style.left = `${x}px`
  tooltip.style.top = `${y}px`
}

// ---- Hover event handlers ----

function onMouseOver(event: MouseEvent) {
  if (!isActive) return

  // Find deepest hovered element
  const hoverElements = document.querySelectorAll(':hover')
  const target = (hoverElements[hoverElements.length - 1] as HTMLElement) || event.target as HTMLElement
  if (!target || target.closest('#fi-panel') || target.closest('#fi-tooltip')) return

  // Only care about text elements
  const textNodes = Array.from(target.childNodes).filter(
    n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
  )
  if (textNodes.length === 0) return

  hoveredElement = target

  // Wrap text nodes for highlighting
  const originalNodes = new Map<HTMLElement, Node>()
  textNodes.forEach(node => {
    if (!node.textContent?.trim()) return
    if (target.tagName === 'FONT-INSPECTOR-TEXT') return
    const wrapper = document.createElement('font-inspector-text')
    wrapper.textContent = node.textContent
    originalNodes.set(wrapper, node)
    node.parentNode?.replaceChild(wrapper, node)
  })
  if (originalNodes.size > 0) {
    ;(target as any)._fiOriginalNodes = originalNodes
  }

  // Highlight wrapped text
  target.querySelectorAll('font-inspector-text').forEach(el => {
    el.classList.add('fi-text-hover')
  })

  // Get computed style and query detection engine
  const computed = window.getComputedStyle(target)
  const style: ElementStyle = {
    fontSize: computed.fontSize,
    lineHeight: computed.lineHeight,
    letterSpacing: computed.letterSpacing,
    color: computed.color,
  }

  // Post rollover query to page.ts
  window.postMessage({
    type: 'ROLLOVER_QUERY',
    fontFamily: computed.fontFamily,
    fontWeight: computed.fontWeight,
    fontStyle: computed.fontStyle,
    _style: style, // pass along for tooltip display
  }, '*')

  // Start tracking mouse position
  document.addEventListener('mousemove', onMouseMove)
}

function onMouseMove(event: MouseEvent) {
  positionTooltip(event.clientX, event.clientY)
}

function onMouseOut(event: MouseEvent) {
  const hoverElements = document.querySelectorAll(':hover')
  const current = hoverElements[hoverElements.length - 1]
  if (current?.tagName === 'FONT-INSPECTOR-TEXT') return // still inside wrapped text

  restoreTextNodes()
  hideTooltip()
  document.removeEventListener('mousemove', onMouseMove)
}

function restoreTextNodes() {
  if (hoveredElement) {
    const originalNodes: Map<HTMLElement, Node> | undefined = (hoveredElement as any)._fiOriginalNodes
    if (originalNodes) {
      originalNodes.forEach((originalNode, wrapper) => {
        wrapper.replaceWith(originalNode)
      })
      delete (hoveredElement as any)._fiOriginalNodes
    }
    hoveredElement = null
  }
}

// ---- Rollover result handler ----

function onRolloverResult(data: { font: DetectedFont | null; style: ElementStyle }) {
  if (!data.font) {
    hideTooltip()
    return
  }
  // _style was passed through from the query
  showTooltip({ font: data.font, style: data.style })
}

// ---- Activation / Deactivation ----

function activate() {
  if (isActive) return
  isActive = true
  if (panel) panel.classList.remove('fi-hidden')
  document.body.addEventListener('mouseover', onMouseOver)
  document.body.addEventListener('mouseout', onMouseOut)
}

function deactivate() {
  isActive = false
  restoreTextNodes()
  hideTooltip()
  if (panel) panel.classList.add('fi-hidden')
  document.body.removeEventListener('mouseover', onMouseOver)
  document.body.removeEventListener('mouseout', onMouseOut)
  document.removeEventListener('mousemove', onMouseMove)
  document.querySelectorAll('.fi-highlight').forEach(el => el.classList.remove('fi-highlight'))
}

// ---- Message handling ----

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return

  switch (event.data.type) {
    case 'FI_TOGGLE':
      if (event.data.visible) activate()
      else deactivate()
      break

    case 'DETECTION_DONE':
      fonts = event.data.fonts
      renderFontList()
      break

    case 'FONT_UPGRADED':
      handleFontUpgraded(event.data.font)
      break

    case 'ROLLOVER_RESULT':
      // Get the style from the original query (passed through _style)
      onRolloverResult(event.data)
      break
  }
})

// ---- Helpers ----

function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

function buildFontFilename(font: DetectedFont): string {
  // Build name like "Inter-Bold.woff2"
  const family = font.family.replace(/\s+/g, '')
  const weight = font.weight.charAt(0).toUpperCase() + font.weight.slice(1)
  const styleSuffix = font.style !== 'normal' ? font.style.charAt(0).toUpperCase() + font.style.slice(1) : ''
  const name = `${family}-${weight}${styleSuffix}`

  // Extract extension from URL
  let ext = 'woff2'
  try {
    const pathname = new URL(font.fontFaceSrc!).pathname
    const match = pathname.match(/\.(woff2?|ttf|otf|eot)(\?|$)/i)
    if (match) ext = match[1].toLowerCase()
  } catch {}

  return `${name}.${ext}`
}

// ---- Bootstrap ----

injectStyles()
panel = createPanel()
tooltip = createTooltip()
