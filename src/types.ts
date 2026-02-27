// ---- Message types between execution contexts ----

export type MessageType =
  | 'TOGGLE'
  | 'SAFE_FETCH'
  | 'SAFE_FETCH_RESULT'
  | 'DETECTION_DONE'
  | 'FONT_UPGRADED'
  | 'ROLLOVER_QUERY'
  | 'ROLLOVER_RESULT'
  | 'DOWNLOAD_FONT'

export interface SafeFetchRequest {
  type: 'SAFE_FETCH'
  url: string
  returnBase64: boolean
  requestId: string
}

export interface SafeFetchResult {
  type: 'SAFE_FETCH_RESULT'
  requestId: string
  data?: string
  error?: string
}

export interface DetectionDoneMessage {
  type: 'DETECTION_DONE'
  fonts: DetectedFont[]
}

export interface FontUpgradedMessage {
  type: 'FONT_UPGRADED'
  font: DetectedFont
}

export interface RolloverQuery {
  type: 'ROLLOVER_QUERY'
  fontFamily: string
  fontWeight: string
  fontStyle: string
}

export interface RolloverResult {
  type: 'ROLLOVER_RESULT'
  font: DetectedFont | null
  style: ElementStyle
}

// ---- Font data ----

export interface DetectedFont {
  id: string                  // normalized style ID for cross-referencing
  family: string              // cleaned family name (e.g. "Inter")
  fullName: string            // e.g. "Inter Bold Italic"
  weight: string              // e.g. "bold", "regular"
  weightNum: number           // e.g. 700, 400
  style: string               // "normal" | "italic" | "oblique"
  source: 'binary' | 'css'   // where the name came from
  variable: boolean
  cssFamily: string           // original CSS font-family value
  fontFaceSrc?: string        // data URI or URL for injecting FontFace
}

export interface FontFaceRule {
  family: string
  weight: string
  style: string
  sources: FontSource[]
}

export interface FontSource {
  url: string
  format: string
}

export interface ElementStyle {
  fontSize: string
  lineHeight: string
  letterSpacing: string
  color: string
}

export interface TooltipData {
  font: DetectedFont
  style: ElementStyle
}
