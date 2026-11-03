import { decodeEntities, stripHtml, splitTitle } from './text.js'

// Pure page and payload parsers, one per source. Fetching lives in sources.js.

export function metaTags(html) {
  const tags = {}
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
    const value = tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i)
    if (key && value && !(key in tags)) tags[key] = decodeEntities(value[1] ?? value[2])
  }
  return tags
}

export function jsonLd(html) {
  const out = []
  for (const [, body] of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(body)
      out.push(...(Array.isArray(data) ? data : data['@graph'] || [data]))
    } catch {}
  }
  return out
}

// Interstitials answer 200, so they have to be recognised by their title. They
// count as unreadable; there's no getting past them and no trying to.
export function isChallenge(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
  return /client challenge|just a moment|attention required|access denied|are you (?:a )?human/i.test(title)
}

export function parseGeneric(html, url) {
  if (isChallenge(html)) throw new Error('page is behind a bot check')
  const tags = metaTags(html)
  const ld = jsonLd(html).find((d) => /Music(Album|Recording|Playlist)|PodcastEpisode|RadioEpisode/.test(d['@type']))
  if (ld) return { ...parseMusicLd(ld, tags), url }
  const title = tags['og:title'] || tags['twitter:title'] || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
  return {
    ...splitTitle(title),
    kind: /song|track/.test(tags['og:type'] || '') ? 'track' : /album/.test(tags['og:type'] || '') ? 'album' : 'page',
    artUrls: [tags['og:image'], tags['twitter:image']].filter(Boolean),
    meta: { description: stripHtml(tags['og:description'] || tags.description), site: tags['og:site_name'] },
  }
}

const yearDate = (s) => {
  const d = new Date(s)
  return Number.isNaN(+d) ? undefined : d.toISOString().slice(0, 10)
}

function parseMusicLd(ld, tags = {}) {
  const album = /Album/.test(ld['@type'])
  const keywords = Array.isArray(ld.keywords) ? ld.keywords : String(ld.keywords || '').split(',').map((k) => k.trim()).filter(Boolean)
  const duration = ld.duration?.match?.(/P(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  // TIDAL lists byArtist as an array; most sites give one object.
  const artist = [ld.byArtist].flat().map((a) => a?.name).filter(Boolean).join(', ') || undefined
  return {
    kind: album ? 'album' : 'track',
    title: ld.name,
    artist: artist ?? tags['og:site_name'],
    album: album ? undefined : ld.inAlbum?.name,
    artUrls: [ld.image, tags['og:image']].flat().filter(Boolean),
    meta: {
      released: yearDate(ld.datePublished),
      tracks: ld.numTracks ?? ld.track?.numberOfItems,
      tags: keywords.slice(0, 12),
      label: ld.publisher?.name && ld.publisher.name !== artist ? ld.publisher.name : undefined,
      seconds: duration ? (Number(duration[1] || 0) * 3600 + Number(duration[2] || 0) * 60 + Number(duration[3] || 0)) : undefined,
      description: stripHtml(ld.description).slice(0, 1200) || undefined,
    },
  }
}

export function parseBandcamp(html, url) {
  if (isChallenge(html)) throw new Error('page is behind a bot check')
  const ld = jsonLd(html).find((d) => /Music(Album|Recording)/.test(d['@type']))
  const tags = metaTags(html)
  if (!ld) return parseGeneric(html, url)
  const item = parseMusicLd(ld, tags)
  // _10 is the large rendition and _0 the original upload.
  item.artUrls = item.artUrls.flatMap((a) => [a.replace(/_\d+\.jpg$/, '_0.jpg'), a])
  return item
}

export function parseSoundcloud(html) {
  const hydration = html.match(/__sc_hydration\s*=\s*(\[.*?\]);\s*<\/script>/s)
  if (!hydration) return null
  const entry = JSON.parse(hydration[1]).find((h) => h.hydratable === 'sound' || h.hydratable === 'playlist')
  if (!entry) return null
  const t = entry.data
  const art = t.artwork_url || t.user?.avatar_url
  const pm = t.publisher_metadata || {}
  return {
    kind: entry.hydratable === 'playlist' ? 'album' : (t.duration > 20 * 60_000 ? 'mix' : 'track'),
    title: t.title,
    artist: pm.artist || t.user?.username,
    album: pm.album_title || undefined,
    artUrls: art ? [art.replace('-large.', '-t1240x1240.'), art.replace('-large.', '-t500x500.'), art] : [],
    meta: {
      released: yearDate(t.release_date || t.display_date || t.created_at),
      uploaded: yearDate(t.created_at),
      genre: t.genre || undefined,
      tags: (t.tag_list?.match(/"[^"]+"|\S+/g) || []).map((s) => s.replaceAll('"', '')).slice(0, 12),
      label: t.label_name || undefined,
      seconds: t.duration ? Math.round(t.duration / 1000) : undefined,
      tracks: t.track_count,
      isrc: pm.isrc || undefined,
      publisher: pm.publisher || undefined,
      writer: pm.writer_composer || undefined,
      plays: t.playback_count ?? undefined,
      likes: t.likes_count ?? undefined,
      reposts: t.reposts_count ?? undefined,
      comments: t.comment_count ?? undefined,
      description: stripHtml(t.description).slice(0, 1200) || undefined,
    },
  }
}

export function parseMixcloud(c) {
  const p = c.pictures || {}
  return {
    kind: 'mix',
    title: c.name,
    artist: c.user?.name,
    artUrls: [p['1024wx1024h'], p['768wx768h'], p['640wx640h'], p.extra_large].filter(Boolean),
    meta: {
      released: yearDate(c.created_time),
      seconds: c.audio_length,
      tags: (c.tags || []).map((t) => t.name),
      plays: c.play_count,
      likes: c.favorite_count,
      reposts: c.repost_count,
      comments: c.comment_count,
      listeners: c.listener_count,
      hosts: (c.hosts || []).map((h) => h.name || h.user?.name).filter(Boolean),
      tracklist: (c.sections || []).map((s) => [s.track?.artist?.name, s.track?.name].filter(Boolean).join(' - ')).filter(Boolean).slice(0, 80),
      description: stripHtml(c.description).slice(0, 1200) || undefined,
    },
  }
}

export function parseSpotify(pageHtml, embedHtml, type) {
  const tags = pageHtml ? metaTags(pageHtml) : {}
  const nextData = embedHtml?.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)
  let e = {}
  if (nextData) {
    try { e = JSON.parse(nextData[1]).props.pageProps.state.data.entity } catch {}
  }
  // Track: "Artist · Album · Song · Year". Album: "Artist · album · Year · 12 songs".
  const bits = (tags['og:description'] || '').split(' · ')
  const year = bits.find((b) => /^\d{4}$/.test(b))
  const art = (e.visualIdentity?.image || []).toSorted((a, b) => (b.maxWidth || 0) - (a.maxWidth || 0))[0]?.url
  const ogTitle = (tags['og:title'] || '').replace(/^Listen to /, '').replace(/ - (?:Album|Single|EP) by .*$/, '').replace(/ \| Spotify$/, '')
  const kind = { track: 'track', album: 'album', episode: 'episode', show: 'show', playlist: 'playlist' }[type]
  const isTrack = type === 'track'
  return {
    kind,
    title: e.name || e.title || ogTitle,
    artist: e.artists?.map((a) => a.name).join(', ') || e.subtitle || (['track', 'album'].includes(type) ? bits[0] : undefined),
    album: isTrack && bits.length >= 4 ? bits[1] : undefined,
    artUrls: [art, tags['og:image']].filter(Boolean),
    meta: {
      released: e.releaseDate?.isoString?.slice(0, 10) || year,
      seconds: e.duration ? Math.round(e.duration / 1000) : undefined,
      explicit: e.isExplicit || undefined,
      tracks: e.trackList?.length || Number(bits.find((b) => /songs?$/.test(b))?.match(/\d+/)?.[0]) || undefined,
      description: ['episode', 'show'].includes(type) ? stripHtml(tags['og:description']) : undefined,
    },
  }
}

export const itunesArt = (url) => (url ? [url.replace(/\/\d+x\d+bb\./, '/3000x3000bb.'), url.replace(/\/\d+x\d+bb\./, '/1200x1200bb.')] : [])

export function parseItunes(r) {
  const isTrack = r.wrapperType === 'track'
  return {
    kind: isTrack ? 'track' : 'album',
    title: isTrack ? r.trackName : r.collectionName,
    artist: r.artistName,
    album: isTrack ? r.collectionName : undefined,
    artUrls: itunesArt(r.artworkUrl100),
    link: (isTrack ? r.trackViewUrl : r.collectionViewUrl)?.replace(/[?&]uo=\d+/, ''),
    meta: {
      released: r.releaseDate?.slice(0, 10),
      genre: r.primaryGenreName,
      seconds: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : undefined,
      tracks: r.trackCount,
      trackNo: isTrack ? r.trackNumber : undefined,
      disc: isTrack && r.discCount > 1 ? r.discNumber : undefined,
      explicit: (r.trackExplicitness || r.collectionExplicitness) === 'explicit' || undefined,
      copyright: r.copyright,
    },
  }
}

export function parseDeezerTrack(t) {
  return {
    kind: 'track',
    title: t.title,
    artist: t.artist?.name,
    album: t.album?.title,
    artUrls: [t.album?.cover_xl].filter(Boolean),
    link: t.link,
    meta: {
      released: t.release_date,
      seconds: t.duration,
      bpm: t.bpm > 0 ? Math.round(t.bpm) : undefined,
      gain: t.gain,
      isrc: t.isrc,
      trackNo: t.track_position,
      disc: t.disk_number > 1 ? t.disk_number : undefined,
      explicit: t.explicit_lyrics || undefined,
      contributors: (t.contributors || []).map((c) => c.name).filter((n) => n !== t.artist?.name),
    },
  }
}

export function parseDeezerAlbum(a) {
  return {
    kind: 'album',
    title: a.title,
    artist: a.artist?.name,
    artUrls: [a.cover_xl].filter(Boolean),
    link: a.link,
    meta: {
      released: a.release_date,
      seconds: a.duration,
      tracks: a.nb_tracks,
      label: a.label,
      upc: a.upc,
      genre: a.genres?.data?.[0]?.name,
      type: a.record_type,
      explicit: a.explicit_lyrics || undefined,
    },
  }
}
