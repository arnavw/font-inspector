// Font detection engine — runs in the page world
// Two-phase: instant CSS detection, then background binary enhancement

import opentype from 'opentype.js'
import {
  cleanFontFamily, cleanFontName, cleanWeight, cleanStyle,
  mapWeight, formatFullName, normalizeStyleId, cleanNameString,
} from './utils'
import type {
  DetectedFont, FontFaceRule, FontSource, RolloverResult, ElementStyle,
} from './types'

// ---- State ----

let detectedFonts: DetectedFont[] = []
let elementFontMap: Map<string, DetectedFont> = new Map() // styleId -> DetectedFont

// ---- CORS-bypassing fetch via background service worker ----

const pendingFetches = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }>()

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return
  if (event.data.type === 'SAFE_FETCH_RESULT') {
    const pending = pendingFetches.get(event.data.requestId)
    if (pending) {
      pendingFetches.delete(event.data.requestId)
      if (event.data.error) pending.reject(new Error(event.data.error))
      else pending.resolve(event.data.data)
    }
  }
  // Trigger detection when UI becomes visible
  if (event.data.type === 'FI_TOGGLE' && event.data.visible) {
    if (detectedFonts.length === 0) {
      const phase1Result = runPhase1()
      runPhase2(phase1Result)
    }
  }
  // Handle rollover queries from UI
  if (event.data.type === 'ROLLOVER_QUERY') {
    handleRollover(event.data)
  }
})

async function safeFetch(url: string, returnBase64 = false): Promise<string> {
  // Try direct fetch first
  try {
    const response = await fetch(url, { mode: 'cors' })
    if (response.ok) {
      if (returnBase64) {
        const buffer = await response.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        return btoa(binary)
      }
      return await response.text()
    }
  } catch { /* CORS blocked, fall through to background proxy */ }

  // Relay through content script -> background service worker
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    pendingFetches.set(requestId, { resolve, reject })
    window.postMessage({ type: 'SAFE_FETCH', url, returnBase64, requestId }, '*')
    // Timeout after 15s
    setTimeout(() => {
      if (pendingFetches.has(requestId)) {
        pendingFetches.delete(requestId)
        reject(new Error(`Fetch timeout: ${url}`))
      }
    }, 15000)
  })
}

// ---- @font-face rule extraction ----

/** Synchronously extract @font-face rules from same-origin stylesheets.
 *  Returns the rules found and a list of CORS-blocked URLs to fetch later. */
function extractSameOriginRules(): { rules: FontFaceRule[]; corsUrls: string[] } {
  const rules: FontFaceRule[] = []
  const corsUrls: string[] = []
  const importUrls: string[] = []

  for (let i = 0; i < document.styleSheets.length; i++) {
    const sheet = document.styleSheets[i]
    try {
      const cssRules = sheet.rules || sheet.cssRules
      if (cssRules) {
        extractFontFaceRules(cssRules, sheet.href || document.location.href, rules, importUrls)
      }
    } catch {
      // CORS blocked
      if (sheet.href) corsUrls.push(sheet.href)
    }
  }

  // Any @import URLs found in same-origin sheets also need fetching
  for (const url of importUrls) {
    corsUrls.push(url)
  }

  return { rules, corsUrls }
}

/** Fetch CORS-blocked stylesheets in parallel and extract their @font-face rules. */
async function fetchCorsRules(corsUrls: string[]): Promise<FontFaceRule[]> {
  const rules: FontFaceRule[] = []
  const fetchedUrls = new Set<string>()
  let urlsToProcess = [...corsUrls]

  // First batch: fetch all CORS URLs in parallel
  while (urlsToProcess.length > 0) {
    const batch = urlsToProcess.filter(u => !fetchedUrls.has(u))
    if (batch.length === 0) break
    for (const u of batch) fetchedUrls.add(u)

    const results = await Promise.allSettled(batch.map(url => safeFetch(url)))
    const nextUrls: string[] = []

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status !== 'fulfilled') continue
      parseCssTextForFontFaces(result.value, batch[i], rules, nextUrls, fetchedUrls)
    }

    // Process any newly discovered @import URLs in next iteration
    urlsToProcess = nextUrls.filter(u => !fetchedUrls.has(u))
  }

  return rules
}

function extractFontFaceRules(
  cssRules: CSSRuleList,
  baseUrl: string,
  rules: FontFaceRule[],
  urlsToFetch: string[]
) {
  for (let i = 0; i < cssRules.length; i++) {
    const rule = cssRules[i]
    if (rule.type === 3) {
      // @import rule
      const importRule = rule as CSSImportRule
      if (importRule.href) {
        try {
          const resolved = new URL(importRule.href, baseUrl).toString()
          urlsToFetch.push(resolved)
        } catch { /* invalid URL */ }
      }
      // Also try reading the imported sheet's rules directly
      try {
        if (importRule.styleSheet?.cssRules) {
          extractFontFaceRules(importRule.styleSheet.cssRules, importRule.href || baseUrl, rules, urlsToFetch)
        }
      } catch { /* CORS */ }
    } else if (rule.type === 4) {
      // @media or @supports — recurse into nested rules
      const groupRule = rule as CSSGroupingRule
      if (groupRule.cssRules) {
        extractFontFaceRules(groupRule.cssRules, baseUrl, rules, urlsToFetch)
      }
    } else if (rule.type === 5) {
      // @font-face
      const parsed = parseFontFaceCSS(rule.cssText, baseUrl)
      if (parsed) rules.push(parsed)
    }
  }
}

function parseCssTextForFontFaces(
  cssText: string,
  baseUrl: string,
  rules: FontFaceRule[],
  urlsToFetch: string[],
  fetchedUrls: Set<string>,
) {
  // Extract @import URLs
  const importRe = /@import\s+(?:url\(\s*['"]?(.+?)['"]?\s*\)|['"](.+?)['"])\s*;/gi
  let m
  while ((m = importRe.exec(cssText)) !== null) {
    const href = m[1] || m[2]
    try {
      const resolved = new URL(href, baseUrl).toString()
      if (!fetchedUrls.has(resolved)) urlsToFetch.push(resolved)
    } catch { /* invalid URL */ }
  }

  // Extract @font-face blocks
  const fontFaceRe = /@font-face\s*\{([^}]+)\}/gi
  while ((m = fontFaceRe.exec(cssText)) !== null) {
    const parsed = parseFontFaceCSS(`@font-face { ${m[1]} }`, baseUrl)
    if (parsed) rules.push(parsed)
  }
}

function parseFontFaceCSS(cssText: string, baseUrl: string): FontFaceRule | null {
  const get = (prop: string): string => {
    const re = new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i')
    const m = cssText.match(re)
    return m ? m[1].trim() : ''
  }

  const family = cleanFontFamily(get('font-family'))
  if (!family) return null

  const weight = get('font-weight') || '400'
  const style = get('font-style') || 'normal'
  const srcValue = get('src')
  if (!srcValue) return null

  const sources = parseFontSrc(srcValue, baseUrl)
  if (sources.length === 0) return null

  return { family, weight, style, sources }
}

function parseFontSrc(srcValue: string, baseUrl: string): FontSource[] {
  const sources: FontSource[] = []
  // Split on comma (but not inside parens)
  const parts = srcValue.split(/,(?![^(]*\))/)

  for (const part of parts) {
    const trimmed = part.trim()

    // Skip local() references
    if (/^local\s*\(/i.test(trimmed)) continue

    // Match url(...) with optional format(...)
    const urlMatch = trimmed.match(/url\s*\(\s*['"]?(.+?)['"]?\s*\)/)
    if (!urlMatch) continue

    let url = urlMatch[1]
    const formatMatch = trimmed.match(/format\s*\(\s*['"]?(.+?)['"]?\s*\)/)
    let format = formatMatch ? formatMatch[1].toLowerCase() : ''

    // Skip icon fonts
    if (/fontawesome/i.test(url)) continue

    // Handle data URIs
    if (url.startsWith('data:')) {
      if (!format) {
        if (url.includes('woff2')) format = 'woff2'
        else if (url.includes('woff')) format = 'woff'
        else if (url.includes('truetype') || url.includes('ttf')) format = 'truetype'
        else if (url.includes('opentype') || url.includes('otf')) format = 'opentype'
      }
      sources.push({ url, format })
      continue
    }

    // Resolve relative URLs
    try { url = new URL(url, baseUrl).toString() } catch { continue }

    // Infer format from extension if not specified
    if (!format) {
      const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase()
      const extMap: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype', eot: 'embedded-opentype' }
      format = ext ? (extMap[ext] || '') : ''
    }

    // Only keep formats we can parse
    if (['woff2', 'woff', 'truetype', 'opentype'].includes(format)) {
      sources.push({ url, format })
    }
  }

  return sources
}

// ---- Walk DOM and catalog computed font styles ----

interface StyleGroup {
  styleId: string
  fontFamily: string       // raw CSS font-family
  fontWeight: string
  fontStyle: string
  elements: Element[]
}

function walkDOM(): Map<string, StyleGroup> {
  const groups = new Map<string, StyleGroup>()
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'BR', 'HR', 'FONT-INSPECTOR-TEXT'])
  const elements = document.body.getElementsByTagName('*')

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    if (skip.has(el.tagName)) continue

    // Only care about elements with text content
    const hasText = Array.from(el.childNodes).some(
      n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
    )
    if (!hasText) continue

    // Skip invisible elements
    const computed = window.getComputedStyle(el)
    if (computed.visibility !== 'visible') continue
    if (computed.display === 'none') continue
    if ((el as HTMLElement).offsetWidth === 0 && (el as HTMLElement).offsetHeight === 0) continue

    const fontFamily = computed.fontFamily
    const fontWeight = computed.fontWeight
    const fontStyle = computed.fontStyle
    const styleId = 'style_' + normalizeStyleId(cleanFontFamily(fontFamily.split(',')[0]), fontWeight, fontStyle)

    if (!groups.has(styleId)) {
      groups.set(styleId, { styleId, fontFamily, fontWeight, fontStyle, elements: [] })
    }
    groups.get(styleId)!.elements.push(el)
  }

  return groups
}

// ---- Match font-face rules to style groups ----

function matchRuleToFamily(rule: FontFaceRule, cssFamily: string): boolean {
  const ruleFamily = rule.family.toLowerCase().replace(/['"]/g, '')
  // CSS font-family is a comma-separated fallback list
  const families = cssFamily.split(',').map(f => f.trim().replace(/['"]/g, '').toLowerCase())
  return families.includes(ruleFamily)
}

function findBestSource(sources: FontSource[]): FontSource | null {
  // Prefer woff2 > woff > truetype > opentype
  const priority = ['woff2', 'woff', 'truetype', 'opentype']
  for (const fmt of priority) {
    const s = sources.find(src => src.format === fmt)
    if (s) return s
  }
  return sources[0] || null
}

function findBestRule(matchingRules: FontFaceRule[], group: StyleGroup): FontFaceRule {
  return matchingRules.find(r => {
    const rw = mapWeight(r.weight).weightNum
    const gw = mapWeight(group.fontWeight).weightNum
    return rw === gw && cleanStyle(r.style) === cleanStyle(group.fontStyle)
  }) || matchingRules[0]
}

interface FontBinaryMeta {
  fullName: string
  family: string
  weight: string
  weightNum: number
  style: string
  variable: boolean
}

function parseFontBinary(base64: string): FontBinaryMeta | null {
  try {
    // Decode base64 to ArrayBuffer
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const buffer = bytes.buffer

    const font = opentype.parse(buffer)
    const names = font.names

    // Name priority (same as Fonts Ninja module_121)
    const getEn = (field: any): string => {
      if (!field) return ''
      return field.en || Object.values(field)[0] as string || ''
    }

    let fullName = ''
    const prefFamily = getEn(names.preferredFamily) || getEn(names.fontFamily)
    const prefSub = getEn(names.preferredSubfamily) || getEn(names.fontSubfamily)

    if (prefFamily && prefSub) {
      fullName = `${prefFamily} ${prefSub}`
    } else if (prefFamily) {
      fullName = prefFamily
    } else {
      fullName = getEn(names.fullName) || ''
    }

    fullName = cleanNameString(fullName)
    if (!fullName) return null

    const family = cleanFontName(fullName) || fullName
    const weightStr = cleanWeight(fullName)
    const os2Weight = (font.tables as any)?.os2?.usWeightClass
    const { weight, weightNum } = weightStr
      ? mapWeight(weightStr)
      : mapWeight(os2Weight || 400)
    const style = cleanStyle(fullName)
    const variable = Boolean((font.tables as any)?.fvar?.axes?.length)

    return { fullName, family, weight, weightNum, style, variable }
  } catch {
    return null
  }
}

// ---- Phase 1: Instant detection (synchronous, <50ms) ----

interface Phase1Result {
  corsUrls: string[]
  styleGroups: Map<string, StyleGroup>
  sameOriginRules: FontFaceRule[]
  seenFamilies: Set<string>
}

function runPhase1(): Phase1Result {
  try {
    // Extract same-origin @font-face rules (no network)
    const { rules: sameOriginRules, corsUrls } = extractSameOriginRules()

    // Walk DOM
    const styleGroups = walkDOM()

    // Build CSS-sourced DetectedFont[] using same-origin rules
    const fonts: DetectedFont[] = []
    const seenFamilies = new Set<string>()

    for (const [styleId, group] of styleGroups) {
      const matchingRules = sameOriginRules.filter(r => matchRuleToFamily(r, group.fontFamily))

      let font: DetectedFont

      if (matchingRules.length > 0) {
        const bestRule = findBestRule(matchingRules, group)
        const bestSource = findBestSource(bestRule.sources)

        const { weight, weightNum } = mapWeight(group.fontWeight)
        const family = cleanFontFamily(bestRule.family)
        font = {
          id: styleId,
          family,
          fullName: formatFullName(family, weight, cleanStyle(group.fontStyle)),
          weight,
          weightNum,
          style: cleanStyle(group.fontStyle),
          source: 'css',
          variable: false,
          cssFamily: group.fontFamily,
          fontFaceSrc: bestSource?.url,
        }

        // Inject FontFace for panel rendering if we have a source
        if (bestSource) {
          try {
            const face = new FontFace(styleId, `url(${bestSource.url})`, {
              weight: String(font.weightNum),
              style: font.style === 'normal' ? 'normal' : 'italic',
            })
            document.fonts.add(face)
          } catch { /* FontFace injection failed */ }
        }
      } else {
        // No @font-face match — CSS-only detection
        const { weight, weightNum } = mapWeight(group.fontWeight)
        const rawFamily = group.fontFamily.split(',')[0].trim().replace(/['"]/g, '')
        const family = cleanFontFamily(rawFamily) || rawFamily
        font = {
          id: styleId,
          family,
          fullName: formatFullName(family, weight, cleanStyle(group.fontStyle)),
          weight,
          weightNum,
          style: cleanStyle(group.fontStyle),
          source: 'css',
          variable: false,
          cssFamily: group.fontFamily,
        }
      }

      // Deduplicate by family+weight+style
      const dedupeKey = `${font.family.toLowerCase()}_${font.weightNum}_${font.style}`
      if (!seenFamilies.has(dedupeKey)) {
        seenFamilies.add(dedupeKey)
        fonts.push(font)
      }

      // Tag DOM elements
      for (const el of group.elements) {
        (el as HTMLElement).dataset.fontInspector = font.id
      }

      // Track for rollover
      elementFontMap.set(styleId, font)
    }

    detectedFonts = fonts

    // Post immediately — panel renders with CSS-sourced names
    window.postMessage({ type: 'DETECTION_DONE', fonts }, '*')

    return { corsUrls, styleGroups, sameOriginRules, seenFamilies }
  } catch (err) {
    console.error('[Font Inspector] Phase 1 detection failed:', err)
    return { corsUrls: [], styleGroups: new Map(), sameOriginRules: [], seenFamilies: new Set() }
  }
}

// ---- Phase 2: Background enhancement (async, parallel) ----

async function runPhase2({ corsUrls, styleGroups, sameOriginRules, seenFamilies }: Phase1Result) {
  try {
    // Fetch CORS stylesheets in parallel
    const corsRules = corsUrls.length > 0 ? await fetchCorsRules(corsUrls) : []
    const allRules = [...sameOriginRules, ...corsRules]

    // Check if CORS sheets revealed new font matches for existing style groups
    // and collect all binary URLs to fetch
    interface BinaryJob {
      url: string
      styleId: string
      group: StyleGroup
      rule: FontFaceRule
      source: FontSource
    }

    const binaryJobs: BinaryJob[] = []
    const seenBinaryUrls = new Set<string>()

    for (const [styleId, group] of styleGroups) {
      const matchingRules = allRules.filter(r => matchRuleToFamily(r, group.fontFamily))
      if (matchingRules.length === 0) continue

      const bestRule = findBestRule(matchingRules, group)
      const bestSource = findBestSource(bestRule.sources)
      if (!bestSource) continue

      const url = bestSource.url.startsWith('data:')
        ? bestSource.url  // data URIs are handled inline
        : bestSource.url

      // Deduplicate binary downloads by URL
      if (!bestSource.url.startsWith('data:') && seenBinaryUrls.has(url)) {
        // Still queue the job — we'll reuse the fetched base64
        binaryJobs.push({ url, styleId, group, rule: bestRule, source: bestSource })
      } else {
        seenBinaryUrls.add(url)
        binaryJobs.push({ url, styleId, group, rule: bestRule, source: bestSource })
      }
    }

    if (binaryJobs.length === 0) return

    // Fetch all unique binary URLs in parallel
    const uniqueUrls = [...seenBinaryUrls]
    const base64Cache = new Map<string, string>()

    // Add data URI entries to cache directly
    for (const job of binaryJobs) {
      if (job.source.url.startsWith('data:')) {
        base64Cache.set(job.url, job.source.url.split(',')[1])
      }
    }

    // Fetch non-data URIs in parallel
    const fetchUrls = uniqueUrls.filter(u => !u.startsWith('data:'))
    if (fetchUrls.length > 0) {
      const results = await Promise.allSettled(fetchUrls.map(url => safeFetch(url, true)))
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') {
          base64Cache.set(fetchUrls[i], (results[i] as PromiseFulfilledResult<string>).value)
        }
      }
    }

    // Parse binaries and upgrade fonts
    for (const job of binaryJobs) {
      const base64 = base64Cache.get(job.url)
      if (!base64) continue

      const meta = parseFontBinary(base64)
      if (!meta) continue

      const upgradedFont: DetectedFont = {
        id: job.styleId,
        family: meta.family,
        fullName: formatFullName(meta.family, meta.weight, meta.style),
        weight: meta.weight,
        weightNum: meta.weightNum,
        style: meta.style,
        source: 'binary',
        variable: meta.variable,
        cssFamily: job.group.fontFamily,
        fontFaceSrc: job.source.url,
      }

      // Inject FontFace for panel rendering
      try {
        const face = new FontFace(job.styleId, `url(${job.source.url})`, {
          weight: String(upgradedFont.weightNum),
          style: upgradedFont.style === 'normal' ? 'normal' : 'italic',
        })
        document.fonts.add(face)
      } catch { /* FontFace injection failed */ }

      // Update in-place in detectedFonts array
      const idx = detectedFonts.findIndex(f => f.id === job.styleId)
      if (idx !== -1) {
        detectedFonts[idx] = upgradedFont
      } else {
        // New font from CORS sheets — check deduplication
        const dedupeKey = `${upgradedFont.family.toLowerCase()}_${upgradedFont.weightNum}_${upgradedFont.style}`
        if (!seenFamilies.has(dedupeKey)) {
          seenFamilies.add(dedupeKey)
          detectedFonts.push(upgradedFont)
        }
      }

      // Update elementFontMap
      elementFontMap.set(job.styleId, upgradedFont)

      // Tag DOM elements that may not have been tagged yet (CORS-only fonts)
      for (const el of job.group.elements) {
        (el as HTMLElement).dataset.fontInspector = upgradedFont.id
      }

      // Notify UI of the upgrade
      window.postMessage({ type: 'FONT_UPGRADED', font: upgradedFont }, '*')
    }
  } catch (err) {
    console.error('[Font Inspector] Phase 2 enhancement failed:', err)
  }
}

// ---- Rollover handler ----

function handleRollover(query: { fontFamily: string; fontWeight: string; fontStyle: string; _style?: ElementStyle }) {
  const styleId = 'style_' + normalizeStyleId(
    cleanFontFamily(query.fontFamily.split(',')[0]),
    query.fontWeight,
    query.fontStyle
  )

  const font = elementFontMap.get(styleId) || null
  const result: RolloverResult = {
    type: 'ROLLOVER_RESULT',
    font,
    style: query._style || { fontSize: '', lineHeight: '', letterSpacing: '', color: '' },
  }
  window.postMessage(result, '*')
}
