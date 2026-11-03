import { get, getJson, getPage } from './http.js'
import { slugTitle } from './text.js'
import {
  parseBandcamp, parseDeezerAlbum, parseDeezerTrack, parseGeneric, parseItunes,
  parseMixcloud, parseSoundcloud, parseSpotify,
} from './parsers.js'

const hostIs = (host, ...domains) => domains.some((d) => host === d || host.endsWith(`.${d}`))

export function detect(url) {
  const host = new URL(url).hostname.toLowerCase()
  if (hostIs(host, 'spotify.com', 'spotify.link')) return 'spotify'
  if (hostIs(host, 'apple.com', 'itunes.com') && /music|itunes/.test(host + new URL(url).pathname)) return 'apple'
  if (hostIs(host, 'deezer.com', 'dzr.page.link')) return 'deezer'
  if (hostIs(host, 'soundcloud.com', 'snd.sc')) return 'soundcloud'
  if (hostIs(host, 'bandcamp.com')) return 'bandcamp'
  if (hostIs(host, 'mixcloud.com')) return 'mixcloud'
  if (hostIs(host, 'youtube.com', 'youtu.be')) return 'youtube'
  if (hostIs(host, 'tidal.com')) return 'tidal'
  if (hostIs(host, 'rte.ie')) return 'rte'
  return 'web'
}

const RTE_STATIONS = {
  radio1: 'RTÉ Radio 1', '2fm': 'RTÉ 2FM', lyricfm: 'RTÉ lyric fm', rnag: 'RTÉ Raidió na Gaeltachta',
  pulse: 'RTÉ Pulse', gold: 'RTÉ Gold', '2xm': 'RTÉ 2XM', junior: 'RTÉjr Radio',
}

// What a link says by itself, for pages that can't be read at all. RTÉ sits
// behind a Cloudflare challenge that refuses this server and Bandcamp sometimes
// does the same, so their links land here. Enrichment may still recognise the
// record; if not, the Telegram reply or web edit fills in the rest.
export function fromUrl(url, source) {
  const { hostname, pathname } = new URL(url)
  const path = pathname.toLowerCase()
  const raw = slugTitle(url)
  const slug = source === 'rte' && raw.toLowerCase() in RTE_STATIONS ? '' : raw
  if (source === 'bandcamp') {
    const artist = hostname.split('.')[0]
    return { kind: path.includes('/album/') ? 'album' : 'track', title: slug || artist, artist, artUrls: [], meta: {}, incomplete: true }
  }
  const station = source === 'rte'
    ? Object.entries(RTE_STATIONS).find(([k]) => path.split('/').includes(k))?.[1] ?? 'RTÉ Radio'
    : undefined
  return {
    kind: source === 'rte' ? 'show' : 'page',
    title: slug || station || hostname.replace(/^www\./, ''),
    artist: slug ? station : undefined,
    artUrls: [],
    meta: {},
    incomplete: true,
  }
}

async function spotify(url) {
  const m = new URL(url).pathname.match(/\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/)
  if (!m) return parseGeneric((await getPage(url)).html, url)
  const [, type, id] = m
  const [page, embed] = await Promise.allSettled([
    getPage(`https://open.spotify.com/${type}/${id}`),
    getPage(`https://open.spotify.com/embed/${type}/${id}`),
  ])
  if (page.status === 'rejected' && embed.status === 'rejected') throw page.reason
  return parseSpotify(page.value?.html, embed.value?.html, type)
}

async function apple(url) {
  const u = new URL(url)
  const country = u.pathname.match(/^\/([a-z]{2})\//)?.[1] ?? 'us'
  const id = u.searchParams.get('i') ?? u.pathname.match(/\/(?:album|song)\/(?:[^/]+\/)?(\d+)$/)?.[1]
  if (!id) return parseGeneric((await getPage(url)).html, url)
  const { results } = await getJson(`https://itunes.apple.com/lookup?id=${id}&country=${country}`)
  if (!results?.[0]) throw new Error('not in the iTunes catalogue')
  return parseItunes(results[0])
}

async function deezer(url) {
  const m = new URL(url).pathname.match(/\/(track|album)\/(\d+)/)
  if (!m) return parseGeneric((await getPage(url)).html, url)
  const data = await getJson(`https://api.deezer.com/${m[1]}/${m[2]}`)
  if (data.error) throw new Error(data.error.message)
  return m[1] === 'track' ? parseDeezerTrack(data) : parseDeezerAlbum(data)
}

async function soundcloud(url) {
  const page = await getPage(url)
  const parsed = parseSoundcloud(page.html)
  if (parsed) return parsed
  const o = await getJson(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(page.url)}`)
  const [title, artist] = o.title.split(/ by (?!.* by )/)
  return { kind: 'track', title, artist: artist ?? o.author_name, artUrls: [o.thumbnail_url].filter(Boolean), meta: {} }
}

async function bandcamp(url) {
  return parseBandcamp((await getPage(url)).html, url)
}

async function mixcloud(url) {
  const path = new URL(url).pathname.replace(/\/?$/, '/')
  return parseMixcloud(await getJson(`https://api.mixcloud.com${path}`))
}

async function youtube(url) {
  const u = new URL(url)
  const id = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') ?? u.pathname.match(/\/(?:shorts|live)\/([^/]+)/)?.[1]
  const o = await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.replace('music.youtube.com', 'www.youtube.com'))}`)
  const dash = o.title.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  const topic = / - Topic$/.test(o.author_name)
  return {
    kind: 'track',
    title: !topic && dash ? dash[2].replace(/\s*[([](?:official|lyric|audio|video|hd|4k)[^)\]]*[)\]]/gi, '').trim() : o.title,
    artist: !topic && dash ? dash[1] : o.author_name.replace(/ - Topic$/, ''),
    artUrls: [id && `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, o.thumbnail_url].filter(Boolean),
    meta: { channel: o.author_name },
  }
}

async function generic(url) {
  return parseGeneric((await getPage(url)).html, url)
}

export const readers = { spotify, apple, deezer, soundcloud, bandcamp, mixcloud, youtube, tidal: generic, rte: generic, web: generic }

// Short links (on.soundcloud.com, spotify.link, link.deezer.com, …) only name
// their service after redirecting.
export async function unshorten(url) {
  const { hostname, pathname } = new URL(url)
  const short = /^(on\.soundcloud\.com|spotify\.link|link\.deezer\.com|dzr\.page\.link|snd\.sc|tidal\.link|.*\.app\.link)$/.test(hostname) || (hostname === 'youtu.be' && !pathname)
  if (!short) return url
  try {
    return (await get(url, { accept: 'text/html' })).finalUrl
  } catch {
    return url
  }
}
