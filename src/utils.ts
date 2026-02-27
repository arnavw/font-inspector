// Weight name -> numeric mapping (comprehensive, from Fonts Ninja module_013)
const WEIGHT_NAME_TO_NUM: Record<string, number> = {
  xthin: 50, extrathin: 50, hairline: 50, ultrathin: 50,
  thin: 100,
  xlight: 200, extralight: 200, ultralight: 200,
  light: 300, clair: 300, lighter: 300,
  book: 400, normal: 400, regular: 400, standard: 400, initial: 400,
  medium: 500,
  demi: 600, semi: 600, demibold: 600, semibold: 600,
  bold: 700,
  xbold: 800, extrabold: 800, ultrabold: 800, bolder: 800,
  heavy: 900, black: 900, noir: 900,
  ultra: 950, xblack: 950, extrablack: 950, poster: 950, ultrablack: 950,
}

const WEIGHT_NUM_TO_NAME: Record<number, string> = {
  100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular',
  500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold',
  900: 'Black', 950: 'Extra Black',
}

// Regex patterns for font name parsing
const COMPOUND_WEIGHT = /(ultra|extra|semi|demi|super)(\s|-)?([a-z]+)/gi
const SHORT_WEIGHT = /e?x-?(thin|light|black|bold|heavy)/gi
const STYLE_PATTERNS = {
  oblique: /oblique/i,
  italic: /italic|italique|Ita?$/i,
  slanted: /slanted/i,
}
const WEIGHT_KEYWORD_RE = /\b(Hair(?:line)?|Bold|Italic|Italique|Slanted|Normal|Regular|Reg|Book|Roman|Medium|Oblique|Thin|Heavy|Black|Noir|Demi|Super|Light|Ultra|Clair|Semi)\b/gi
const WEIGHT_EXTRACT_RE = /\w*?((Ultra|Extra|Semi|Demi)(\s|-|X-)?([Tt]hin|[Ll]ight|[Bb]lack|[Bb]old|[Hh]eavy)|Hair(?:line)?|[xX]?Thin|Light|Medium|[xX]?Bold|Black|Heavy|Standard|Book)\w*?/gi

/** Strip null bytes and normalize dashes/spaces */
export function cleanNameString(s: string): string {
  return (s || '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u0008\uD800-\uDBFF]/g, '')
    .trim()
}

/** Strip quotes and artifacts from CSS font-family values */
export function cleanFontFamily(raw: string): string {
  return decodeURIComponent(raw)
    .replace(/"(.+?)"/g, '$1')
    .replace(/'(.+?)'/g, '$1')
    .replace(/\s+\w+=.+(\S|$)/g, '')
    .replace(/^.*?([a-z0-9]+.*[a-z0-9]+).*?$/i, '$1')
}

/** Strip weight/style keywords from a font name to get the family root */
export function cleanFontName(name: string): string {
  let s = name.trim()
  if (/^(sans|sans-serif|monospace|serif|system-ui|cursive|emoji)/i.test(s)) return s
  s = s.replace(/[^\w\s-]/g, '')
  s = s.replace(COMPOUND_WEIGHT, ' ')
  s = s.replace(SHORT_WEIGHT, ' ')
  s = s.replace(/Ita?$/, ' ')
  s = s.replace(/\sita?$/i, ' ')
  s = s.replace(/\b(italic|italique|slanted|oblique)\b/gi, ' ')
  s = s.replace(WEIGHT_KEYWORD_RE, ' ')
  const words = s.match(/\w+/g)
  return words ? words.join(' ').trim() : s.trim()
}

/** Extract weight keyword from a full font name string */
export function cleanWeight(name: string): string {
  let s = name || ''
  if (s.match(/demi$/i)) s = s.slice(0, -4) + 'Semibold'
  if (s.match(/ultra$/i)) s = s.slice(0, -5) + 'Ultrablack'
  const matches = s.match(WEIGHT_EXTRACT_RE)
  if (matches) {
    const sorted = matches.sort((a, b) => b.length - a.length)
    return sorted[0].replace(/[\s-]/g, '').toLowerCase()
  }
  return ''
}

/** Map a weight string or number to { weight, weightNum } */
export function mapWeight(value: string | number): { weight: string; weightNum: number } {
  if (typeof value === 'number' || !isNaN(Number(value))) {
    let num = Number(value) || 400
    if (num < 0) num = -num
    if (num === 0) num = 400
    while (num > 1000) num = Math.floor(num / 10)
    while (num < 10) num *= 10
    num = num <= 50 ? 100 : num >= 950 ? 950 : 100 * Math.round(num / 100)
    return { weight: WEIGHT_NUM_TO_NAME[num] || 'Regular', weightNum: num }
  }
  const key = String(value).toLowerCase().replace(/[\s-]/g, '')
  if (WEIGHT_NAME_TO_NUM[key] !== undefined) {
    const num = WEIGHT_NAME_TO_NUM[key]
    return { weight: WEIGHT_NUM_TO_NAME[num] || value, weightNum: num }
  }
  return { weight: String(value), weightNum: 400 }
}

/** Normalize font style to standard values */
export function cleanStyle(value: string): string {
  const s = value || ''
  if (STYLE_PATTERNS.oblique.test(s)) return 'oblique'
  if (STYLE_PATTERNS.italic.test(s)) return 'italic'
  if (STYLE_PATTERNS.slanted.test(s)) return 'slanted'
  return 'normal'
}

/** Build a human-readable full name: "Inter Bold Italic" */
export function formatFullName(family: string, weight: string, style: string): string {
  const base = `${family} ${weight}`
  return style !== 'normal' ? `${base} ${capitalize(style)}` : base
}

/** Create a stable ID from font family + weight + style */
export function normalizeStyleId(family: string, weight: string, style: string): string {
  return [family, weight, style, btoa(family).substring(0, 5)]
    .map(s => s.replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase())
    .join('_')
}

/** Convert rgba/rgb CSS string to hex */
export function rgbaToHex(rgbaString: string): string {
  return '#' + rgbaString
    .replace(/^rgba?\(|\s+|\)$/g, '')
    .split(',')
    .slice(0, 3) // drop alpha
    .map(s => parseFloat(s.trim()))
    .map(n => n.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
