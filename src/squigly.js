import { getPage } from './http.js'
import { settings } from './config.js'
import { stripHtml } from './text.js'

const BASE = 'https://squigly.link'
const SERVICES = ['spotify', 'apple', 'youtube', 'tidal', 'deezer', 'amazon', 'bandcamp', 'soundcloud']
// Its slower services (Amazon, YouTube) land a few seconds after the link exists.
const WAITS = [0, 2500, 2500, 3000]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Each song page carries everything in one inline script.
export function parseSquigly(html) {
  const raw = html.match(/window\.__SQUIGLY_LINK__\s*=\s*(\{.*?\});\s*<\/script>/s)?.[1]
  if (!raw) return null
  const { data } = JSON.parse(raw)
  const links = {}
  for (const service of SERVICES) {
    if (data.services?.[service]?.url) links[service] = data.services[service].url
  }
  return {
    // Albums call it name.
    title: data.title ?? data.name,
    artist: data.artist,
    album: data.album ?? undefined,
    artUrls: [data.artwork_url].filter(Boolean),
    pending: data.pending ?? [],
    links,
    meta: {
      genre: data.genre ?? undefined,
      released: data.release_date ?? undefined,
      tracks: data.total_tracks ?? undefined,
      description: stripHtml(data.description).slice(0, 1200) || undefined,
    },
  }
}

// Anonymous tier: no key and a few requests a window, shared by everything on
// the same IP.
export async function expand(url) {
  const res = await fetch(`${BASE}/api/create`, {
    method: 'POST',
    signal: AbortSignal.timeout(12_000),
    headers: { 'Content-Type': 'application/json', 'User-Agent': settings.userAgent },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} from squigly.link`)
  const created = await res.json()
  // Cached answers leave the flag out, so only an explicit false counts.
  if (created.has_reliable_matches === false || !created.full_url) return null
  let found = null
  for (const wait of WAITS) {
    await sleep(wait)
    found = parseSquigly((await getPage(created.full_url)).html) ?? found
    if (found && !found.pending.length) break
  }
  return found && { ...found, page: created.full_url }
}
