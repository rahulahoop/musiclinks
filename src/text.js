const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export const decodeEntities = (s) => String(s ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, e) => {
  if (e[0] === '#') {
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  }
  return ENTITIES[e.toLowerCase()] ?? whole
})

export const stripHtml = (s) => decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

// Telegram shares arrive as "Check this out https://…", so the link can sit
// anywhere in the text and whatever surrounds it is kept.
export function parseInput(input) {
  const text = String(input ?? '').trim()
  const match = text.match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return { url: null, rest: text }
  const url = match[0].replace(/[),.;!?]+$/, '')
  return { url, rest: text.replace(match[0], ' ').replace(/\s+/g, ' ').trim() }
}

// "Title — Artist". Dashes with spaces only, so hyphenated titles stay whole.
export function splitTitle(text) {
  const parts = String(text ?? '').split(/\s+[-–—]\s+/)
  if (parts.length < 2) return { title: String(text ?? '').trim() }
  return { title: parts[0].trim(), artist: parts.slice(1).join(' - ').trim() }
}

export function normal(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\((?:feat|ft|with|remaster|deluxe|explicit|clean)[^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster|single|mono|stereo|radio edit).*$/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// Loose on purpose (remaster tags, "The", feat. credits) but both title and
// artist must agree: a wrong album cover is worse than a missing link.
export function sameWork(a, b) {
  const close = (x, y) => {
    const [p, q] = [normal(x).replace(/^the /, ''), normal(y).replace(/^the /, '')]
    if (!p || !q) return false
    // Bandcamp subdomains run the name together: nilsfrahm, Nils Frahm.
    return p === q || p.startsWith(`${q} `) || q.startsWith(`${p} `) || p.replaceAll(' ', '') === q.replaceAll(' ', '')
  }
  return close(a.title, b.title) && close(a.artist, b.artist)
}

export function slugTitle(url) {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  const slug = [...segments].reverse().find((s) => !/^\d+$/.test(s) && /[a-z]/i.test(s) && !/^(radio|clips?|shows?|programmes?|podcasts?|episodes?)$/i.test(s))
  if (!slug) return ''
  return decodeURIComponent(slug).replace(/\.[a-z]{2,5}$/i, '').replace(/[-_]+/g, ' ').replace(/^\d{4,}\s|\s\d{4,}$/g, '').trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}
