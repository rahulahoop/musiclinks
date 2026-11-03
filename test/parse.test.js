import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertPublic, buildLinks, configure, detect, enrich, fromUrl, getJson, isChallenge, metaTags, normal, openLink,
  parseBandcamp, parseGeneric, parseInput, parseItunes, parseMixcloud, parseSoundcloud, parseSpotify, parseSquigly,
  pickCover, sameWork, slugTitle, splitTitle, stripHtml,
} from '../index.js'

test('parseInput finds a link anywhere and keeps the rest', () => {
  assert.deepEqual(parseInput('so good https://x.com/a/b). wow'), { url: 'https://x.com/a/b', rest: 'so good wow' })
  assert.deepEqual(parseInput('radiohead weird fishes'), { url: null, rest: 'radiohead weird fishes' })
})

test('splitTitle needs a spaced dash', () => {
  assert.deepEqual(splitTitle('Sunday Miscellany — RTÉ Radio 1'), { title: 'Sunday Miscellany', artist: 'RTÉ Radio 1' })
  assert.deepEqual(splitTitle('Anti-Hero'), { title: 'Anti-Hero' })
})

test('sameWork tolerates tags and joined names, but not a different record', () => {
  assert.ok(sameWork({ title: 'Paranoid Android (Remastered)', artist: 'Radiohead' }, { title: 'Paranoid Android', artist: 'Radiohead' }))
  assert.ok(sameWork({ title: 'Spaces', artist: 'nilsfrahm' }, { title: 'Spaces (Special Edition)', artist: 'Nils Frahm' }))
  assert.ok(!sameWork({ title: 'Creep', artist: 'Radiohead' }, { title: 'Creep', artist: 'TLC' }))
  assert.ok(!sameWork({ title: 'Creep', artist: 'Radiohead' }, { title: 'Karma Police', artist: 'Radiohead' }))
  assert.equal(normal('Beyoncé & Jay-Z'), 'beyonce and jay z')
})

test('detect routes each service', () => {
  const cases = {
    'https://open.spotify.com/track/1': 'spotify', 'https://music.apple.com/ie/album/x/1': 'apple',
    'https://www.deezer.com/track/1': 'deezer', 'https://soundcloud.com/a/b': 'soundcloud',
    'https://a.bandcamp.com/album/b': 'bandcamp', 'https://www.mixcloud.com/a/b/': 'mixcloud',
    'https://music.youtube.com/watch?v=1': 'youtube', 'https://youtu.be/1': 'youtube',
    'https://www.rte.ie/radio/radio1/clips/1/': 'rte', 'https://www.nts.live/shows/a': 'web',
    'https://evilspotify.com/track/1': 'web',
  }
  for (const [url, source] of Object.entries(cases)) assert.equal(detect(url), source, url)
})

test('fromUrl makes the best of an unreadable link', () => {
  const show = fromUrl('https://www.rte.ie/radio/radio1/the-history-show/programmes/2026/1101/1234567-sunday-show/', 'rte')
  assert.deepEqual([show.title, show.artist, show.kind, show.incomplete], ['Sunday Show', 'RTÉ Radio 1', 'show', true])
  const clip = fromUrl('https://www.rte.ie/radio/lyricfm/clips/22543301/', 'rte')
  assert.deepEqual([clip.title, clip.artist], ['RTÉ lyric fm', undefined])
  const album = fromUrl('https://nilsfrahm.bandcamp.com/album/all-melody', 'bandcamp')
  assert.deepEqual([album.title, album.artist, album.kind], ['All Melody', 'nilsfrahm', 'album'])
  assert.equal(slugTitle('https://x.com/a-b_c'), 'A B C')
})

test('challenge pages are unreadable, not titles', () => {
  const page = '<html><title>Client Challenge</title></html>'
  assert.ok(isChallenge(page))
  assert.ok(isChallenge('<title>Just a moment...</title>'))
  assert.throws(() => parseBandcamp(page, 'https://a.bandcamp.com/album/b'))
})

test('metaTags decodes entities and handles either attribute order', () => {
  const tags = metaTags(`<meta content="A &amp; B" property="og:title"><meta name="description" content='x'>`)
  assert.deepEqual(tags, { 'og:title': 'A & B', description: 'x' })
})

test('parseSpotify reads the track line and the album line', () => {
  const track = parseSpotify('<meta property="og:title" content="Song"><meta property="og:description" content="Artist · Record · Song · 1987">', null, 'track')
  assert.deepEqual([track.title, track.artist, track.album, track.meta.released], ['Song', 'Artist', 'Record', '1987'])
  const album = parseSpotify('<meta property="og:title" content="Listen to Record - Album by Artist | Spotify"><meta property="og:description" content="Artist · album · 1997 · 12 songs">', null, 'album')
  assert.deepEqual([album.title, album.artist, album.album, album.meta.tracks], ['Record', 'Artist', undefined, 12])
})

test('parseSoundcloud reads hydration, upgrades art, flags long uploads as mixes', () => {
  const data = { title: 'T', duration: 3_600_000, genre: 'House', tag_list: 'deep "two words"', artwork_url: 'https://i1.sndcdn.com/a-large.jpg', user: { username: 'U' }, created_at: '2020-01-02T00:00:00Z', playback_count: 5 }
  const item = parseSoundcloud(`<script>window.__sc_hydration = ${JSON.stringify([{ hydratable: 'sound', data }])};</script>`)
  assert.equal(item.kind, 'mix')
  assert.equal(item.artUrls[0], 'https://i1.sndcdn.com/a-t1240x1240.jpg')
  assert.deepEqual(item.meta.tags, ['deep', 'two words'])
  assert.equal(parseSoundcloud('<html></html>'), null)
})

test('parseBandcamp reads JSON-LD', () => {
  const ld = { '@type': 'MusicAlbum', name: 'A', byArtist: { name: 'B' }, numTracks: 3, image: 'https://f4.bcbits.com/img/a1_10.jpg', keywords: ['ambient'], datePublished: '18 Nov 2013 00:00:00 GMT' }
  const item = parseBandcamp(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`, 'https://b.bandcamp.com/album/a')
  assert.deepEqual([item.kind, item.title, item.artist, item.meta.tracks, item.meta.released], ['album', 'A', 'B', 3, '2013-11-18'])
  assert.equal(item.artUrls[0], 'https://f4.bcbits.com/img/a1_0.jpg')
})

test('parseMixcloud and parseItunes', () => {
  const mix = parseMixcloud({ name: 'M', user: { name: 'U' }, audio_length: 60, pictures: { '1024wx1024h': 'https://x/1.png' }, tags: [{ name: 'Funk' }], sections: [{ track: { name: 'S', artist: { name: 'A' } } }] })
  assert.deepEqual([mix.kind, mix.meta.tags[0], mix.meta.tracklist[0]], ['mix', 'Funk', 'A - S'])
  const it = parseItunes({ wrapperType: 'track', trackName: 'T', artistName: 'A', collectionName: 'C', artworkUrl100: 'https://x/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/t?i=1&uo=4' })
  assert.equal(it.artUrls[0], 'https://x/3000x3000bb.jpg')
  assert.equal(it.link, 'https://music.apple.com/t?i=1')
})

test('buildLinks: source first, exact over search, no searches for radio', () => {
  const links = buildLinks({ kind: 'track', title: 'T', artist: 'A' }, 'spotify', 'https://open.spotify.com/track/1', { apple: 'https://music.apple.com/x' })
  assert.deepEqual(links.slice(0, 2).map((l) => [l.platform, l.exact]), [['spotify', true], ['apple', true]])
  assert.equal(links.filter((l) => l.platform === 'spotify').length, 1)
  assert.equal(links.find((l) => l.platform === 'tidal').exact, false)
  assert.equal(links.find((l) => l.platform === 'qobuz').url, 'https://play.qobuz.com/search?q=A%20T')
  assert.equal(buildLinks({ kind: 'show', title: 'T', artist: 'RTÉ' }, 'rte', 'https://www.rte.ie/x').length, 1)
  assert.equal(buildLinks({ kind: 'track', title: 'T', artist: 'A' }, 'web', 'javascript:alert(1)').some((l) => l.url.startsWith('javascript')), false)
})

test('openLink only rewrites exact Spotify links', () => {
  const id = '0ZkJKXYqRizAgEVxdqlfyV'
  assert.equal(openLink(`https://open.spotify.com/intl-de/track/${id}?si=abc`, 'https://a'), `https://a/s/track/${id}`)
  assert.equal(openLink('https://open.spotify.com/search/x', 'https://a'), 'https://open.spotify.com/search/x')
  assert.equal(openLink('https://tidal.com/browse/track/1', 'https://a'), 'https://tidal.com/browse/track/1')
})

test('assertPublic refuses internal addresses', async () => {
  for (const url of ['http://127.0.0.1:3005/', 'http://10.0.0.1/', 'http://100.96.59.45:8096/', 'http://[::1]/', 'http://169.254.169.254/', 'file:///etc/passwd']) {
    await assert.rejects(assertPublic(url), url)
  }
  await assert.doesNotReject(assertPublic('http://1.1.1.1/'))
})

test('parseSquigly keeps resolved services and what is still pending', () => {
  const data = { title: 'T', artist: 'A', album: 'R', genre: 'Rock', release_date: '1984-04-30', artwork_url: 'https://x/1.jpg', pending: ['amazon'],
    services: { spotify: { url: 'https://open.spotify.com/track/1' }, bandcamp: null, tidal: { url: null } } }
  const found = parseSquigly(`<script>window.__SQUIGLY_LINK__ = ${JSON.stringify({ rendered_at: 1, data })};</script><script>x</script>`)
  assert.deepEqual(found.links, { spotify: 'https://open.spotify.com/track/1' })
  assert.deepEqual(found.pending, ['amazon'])
  assert.deepEqual([found.album, found.meta.genre, found.meta.released], ['R', 'Rock', '1984-04-30'])
  const album = parseSquigly(`<script>window.__SQUIGLY_LINK__ = ${JSON.stringify({ data: { name: 'Record', artist: 'A', total_tracks: 10, description: 'The <i>best</i>', services: {} } })};</script>`)
  assert.deepEqual([album.title, album.meta.tracks, album.meta.description], ['Record', 10, 'The best'])
  assert.equal(parseSquigly('<html></html>'), null)
})

test('stripHtml', () => assert.equal(stripHtml('a&nbsp;<a href="x">b</a>'), 'a b'))

test('JSON-LD with several artists (TIDAL) names them, not the site', () => {
  const html = `<meta property="og:site_name" content="Music on TIDAL"><script type="application/ld+json">${JSON.stringify({
    '@type': 'MusicAlbum', name: 'In Rainbows', byArtist: [{ '@type': 'MusicGroup', name: 'Radiohead' }],
  })}</script>`
  const item = parseGeneric(html, 'https://tidal.com/album/61799588')
  assert.equal(item.title, 'In Rainbows')
  assert.equal(item.artist, 'Radiohead')
})

test('pickCover hotlinks a sensible size', () => {
  assert.equal(pickCover(['https://is1-ssl.mzstatic.com/image/thumb/a/b.jpg/3000x3000bb.jpg']), 'https://is1-ssl.mzstatic.com/image/thumb/a/b.jpg/600x600bb.jpg')
  assert.equal(pickCover(['https://f4.bcbits.com/img/a123_0.jpg']), 'https://f4.bcbits.com/img/a123_16.jpg')
  assert.equal(pickCover(['http://insecure/x.jpg', 'https://i.scdn.co/image/x']), 'https://i.scdn.co/image/x')
  assert.equal(pickCover([]), null)
})

test('configure sets the User-Agent and lookup hook', async () => {
  const seen = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    seen.push(init.headers['User-Agent'])
    return new Response('{"results":[]}', { headers: { 'content-type': 'application/json' } })
  }
  const counted = []
  configure({ userAgent: 'test-app/1 (+https://example.com)', onLookup: (s, o) => counted.push(`${s}:${o}`) })
  try {
    await getJson('https://1.1.1.1/x')
    assert.deepEqual(seen, ['test-app/1 (+https://example.com)'])
    // Nothing found anywhere (and no ISRC/UPC for MusicBrainz): every try is a miss.
    await enrich({ kind: 'album', title: 'Nothing', artist: 'Nobody', artUrls: [], meta: {} }, null, 'web')
    assert.deepEqual(counted.sort(), ['apple:miss', 'deezer:miss', 'musicbrainz:miss'])
  } finally {
    globalThis.fetch = realFetch
    configure({ onLookup: null })
  }
})
