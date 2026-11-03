import { getJson } from './http.js'
import { sameWork } from './text.js'
import { parseDeezerAlbum, parseDeezerTrack, parseItunes } from './parsers.js'
import { expand } from './squigly.js'
import { countLookup } from './config.js'

const SEARCHES = {
  spotify: (q) => `https://open.spotify.com/search/${q}`,
  apple: (q) => `https://music.apple.com/search?term=${q}`,
  youtube: (q) => `https://music.youtube.com/search?q=${q}`,
  tidal: (q) => `https://listen.tidal.com/search?q=${q}`,
  qobuz: (q) => `https://play.qobuz.com/search?q=${q}`,
  deezer: (q) => `https://www.deezer.com/search/${q}`,
  amazon: (q) => `https://music.amazon.com/search/${q}`,
  bandcamp: (q) => `https://bandcamp.com/search?q=${q}`,
  soundcloud: (q) => `https://soundcloud.com/search?q=${q}`,
}

export const PLATFORM_NAMES = {
  spotify: 'Spotify', apple: 'Apple Music', youtube: 'YouTube Music', tidal: 'Tidal', qobuz: 'Qobuz', deezer: 'Deezer',
  amazon: 'Amazon Music', bandcamp: 'Bandcamp', soundcloud: 'SoundCloud', mixcloud: 'Mixcloud', rte: 'RTÉ', web: 'Original link',
  squigly: 'Squigly',
}

// Exact Spotify links open through a hand-off page (base + /s/<type>/<id>) that
// starts the Spotify app; anything else is returned as is.
export function openLink(url, base = '') {
  const m = url.match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist|show|episode)\/([A-Za-z0-9]{22})/)
  return m ? `${base}/s/${m[1]}/${m[2]}` : url
}

const MB_LINKS = [
  [/open\.spotify\.com/, 'spotify'], [/music\.apple\.com|itunes\.apple\.com/, 'apple'],
  [/tidal\.com/, 'tidal'], [/qobuz\.com/, 'qobuz'], [/deezer\.com/, 'deezer'], [/music\.amazon/, 'amazon'],
  [/bandcamp\.com/, 'bandcamp'], [/soundcloud\.com/, 'soundcloud'], [/music\.youtube\.com/, 'youtube'],
]

export function isMusic(item) {
  return (item.kind === 'track' || item.kind === 'album') && !!item.artist
}

// Exact links first, then a search on every other service. A search is one tap
// from the right thing and never lands on the wrong record.
export function buildLinks(item, source, url, exact = {}) {
  const links = []
  const seen = new Set()
  const add = (platform, href, isExact) => {
    if (seen.has(platform) || !href?.startsWith('https://')) return
    seen.add(platform)
    links.push({ platform, name: PLATFORM_NAMES[platform] ?? platform, url: href, exact: isExact })
  }
  add(source, url, true)
  for (const [platform, href] of Object.entries(exact)) add(platform, href, true)
  if (isMusic(item)) {
    const q = encodeURIComponent(`${item.artist} ${item.title}`)
    for (const [platform, search] of Object.entries(SEARCHES)) add(platform, search(q), false)
  }
  return links
}

const fill = (target, extra) => {
  for (const [key, value] of Object.entries(extra)) {
    if (target[key] == null || (Array.isArray(target[key]) && !target[key].length)) target[key] = value
  }
}

function merge(item, found) {
  // A page we couldn't read only had a slug to go on; the match knows better.
  if (item.incomplete) {
    Object.assign(item, { title: found.title, artist: found.artist, incomplete: false })
  }
  if (item.meta.released?.length === 4 && found.meta.released?.startsWith(item.meta.released)) item.meta.released = found.meta.released
  fill(item.meta, found.meta)
  if (!item.album && found.album) item.album = found.album
  item.artUrls = [...item.artUrls, ...found.artUrls]
}

export async function searchItunes(term, entity) {
  const { results } = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=8`)
  return (results || []).map(parseItunes)
}

export async function searchDeezer(term, type) {
  const { data } = await getJson(`https://api.deezer.com/search/${type}?q=${encodeURIComponent(term)}&limit=8`)
  return (data || []).map((d) => ({ id: d.id, title: d.title, artist: d.artist?.name }))
}

async function fromItunes(item) {
  const hits = await searchItunes(`${item.artist} ${item.title}`, item.kind === 'album' ? 'album' : 'song')
  return hits.find((h) => sameWork(h, item))
}

async function fromDeezer(item) {
  const type = item.kind === 'album' ? 'album' : 'track'
  const hit = (await searchDeezer(`${item.artist} ${item.title}`, type)).find((h) => sameWork(h, item))
  if (!hit) return null
  const full = await getJson(`https://api.deezer.com/${type}/${hit.id}`)
  if (full.error) return null
  const parsed = type === 'album' ? parseDeezerAlbum(full) : parseDeezerTrack(full)
  // The album adds the label and barcode a track doesn't carry.
  if (type === 'track' && full.album?.id) {
    const album = await getJson(`https://api.deezer.com/album/${full.album.id}`).catch(() => null)
    if (album && !album.error) {
      const { meta } = parseDeezerAlbum(album)
      parsed.meta = { ...parsed.meta, label: meta.label, upc: meta.upc, genre: meta.genre, tracks: meta.tracks }
    }
  }
  return parsed
}

// MusicBrainz allows one request a second; everything queues behind this.
let mbQueue = Promise.resolve()
function mb(path) {
  const url = `https://musicbrainz.org/ws/2/${path}${path.includes('?') ? '&' : '?'}fmt=json`
  const run = mbQueue.then(() => getJson(url)).catch(async (e) => {
    if (e.status !== 503) throw e
    await new Promise((r) => setTimeout(r, 2000))
    return getJson(url)
  })
  mbQueue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)))
  return run
}

async function fromMusicBrainz(item) {
  const { isrc, upc } = item.meta
  if (!isrc && !upc) return null
  const tags = new Map()
  const addTags = (list) => list?.forEach((t) => tags.set(t.name, (tags.get(t.name) || 0) + t.count))
  let release
  if (isrc) {
    const { recordings } = await mb(`recording/?query=isrc:${isrc}&limit=1`)
    addTags(recordings?.[0]?.tags)
    const releases = recordings?.[0]?.releases ?? []
    release = releases.find((r) => r.status === 'Official' && r.title === item.album) ?? releases.find((r) => r.status === 'Official') ?? releases[0]
  } else {
    release = (await mb(`release/?query=barcode:${upc}&limit=1`)).releases?.[0]
  }
  const links = {}
  let label
  if (release?.id) {
    const full = await mb(`release/${release.id}?inc=url-rels+labels+tags`)
    addTags(full.tags)
    for (const { url } of full.relations ?? []) {
      const platform = MB_LINKS.find(([host]) => host.test(url?.resource ?? ''))?.[1]
      if (platform && !links[platform]) links[platform] = url.resource
    }
    label = full['label-info']?.[0]?.label?.name
  }
  const top = [...tags].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 8)
  return { links, meta: { label: label || undefined, tags: top } }
}

// Services Squigly can start from. Anything else goes through the Apple or
// Deezer match, if there is one.
const SQUIGLY_SOURCES = new Set(['apple', 'spotify', 'deezer', 'tidal', 'youtube'])

// Every step is best effort: the entry is saved with whatever came back.
export async function enrich(item, url, source) {
  const exact = {}
  if (!isMusic(item)) return exact
  const [itunes, deezer] = await Promise.allSettled([fromItunes(item), fromDeezer(item)])
  for (const [platform, result] of [['apple', itunes], ['deezer', deezer]]) {
    if (result.status === 'rejected') console.error(`[enrich] ${platform}: ${result.reason.message}`)
    countLookup(platform, result.status === 'rejected' ? 'error' : result.value ? 'hit' : 'miss')
    if (!result.value) continue
    merge(item, result.value)
    if (result.value.link) exact[platform] = result.value.link
  }
  const start = SQUIGLY_SOURCES.has(source) ? url : exact.apple ?? exact.deezer
  if (start) {
    try {
      const found = await expand(start)
      const hit = found && sameWork(found, item)
      countLookup('squigly', hit ? 'hit' : 'miss')
      if (hit) {
        merge(item, found)
        Object.assign(exact, found.links, exact)
        exact.squigly = found.page
      }
    } catch (e) {
      countLookup('squigly', 'error')
      console.error(`[enrich] squigly: ${e.message}`)
    }
  }
  try {
    const found = await fromMusicBrainz(item)
    countLookup('musicbrainz', found ? 'hit' : 'miss')
    if (found) {
      fill(item.meta, found.meta)
      for (const [platform, link] of Object.entries(found.links)) exact[platform] ??= link
    }
  } catch (e) {
    countLookup('musicbrainz', 'error')
    console.error(`[enrich] musicbrainz: ${e.message}`)
  }
  return exact
}
