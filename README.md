# musiclinks

A music link (or "artist title" text) in. Title, artist, cover, details, and the
same record on every streaming service out.

Used by [All Ears](https://allears.legume.dad), [albex](https://albex.legume.dad)
and the songshare Telegram bot. Node 22+, ES modules, no dependencies.

```js
import { configure, resolve, pickCover } from 'musiclinks'

configure({ userAgent: 'myapp/1.0 (+https://myapp.example)' })

const r = await resolve('https://open.spotify.com/album/6dVIqQ8qmQ5GBnJ9shOYGE')
r.title    // 'OK Computer'
r.artist   // 'Radiohead'
r.kind     // 'album'
r.links    // [{ platform: 'spotify', name: 'Spotify', url, exact: true }, { platform: 'apple', … }, …]
pickCover(r.artUrls)
```

## How a link is resolved

1. **Read the source.** Short links are expanded first. Then the service's own
   data is read: Spotify page and embed, the iTunes lookup API, the Deezer API,
   SoundCloud page data, Bandcamp JSON-LD, the Mixcloud API, or YouTube oEmbed.
   Anything else (TIDAL included) goes through Open Graph tags and JSON-LD.
   Plain text is searched on Apple.
2. **Match.** Tracks and albums are matched by artist and title on iTunes and
   Deezer. Both have to agree (`sameWork`): a wrong album is worse than a
   missing one.
3. **Expand.** [Squigly](https://squigly.link) turns an Apple, Spotify,
   Deezer, TIDAL or YouTube link into exact links elsewhere. This uses its
   anonymous tier, a few requests a window shared by everything on one IP.
4. **MusicBrainz**, by ISRC or UPC, fills in what's still missing. In practice
   that's mostly Qobuz. It's queued at one request a second.
5. **Search links** cover every service that's left (`exact: false`).

Every step is best effort. A page that can't be read gives what its URL says,
with `incomplete: true`.

Requests go out under the one User-Agent you configure. Sites that answer with
a bot challenge (RTÉ, sometimes Bandcamp) are not worked around. Redirects are
followed by hand, and private and loopback addresses are refused at every hop,
so a pasted link can't reach the server's own services.

## API

- `configure({ userAgent, onLookup })`. `onLookup(service, outcome)` is called
  for every match tried, with outcome `'hit'`, `'miss'` or `'error'`. Wire it
  to a metrics counter.
- `resolve(input)` returns the result described in `index.d.ts`.
- `openLink(url, base)` routes exact Spotify links through `${base}/s/<type>/<id>`,
  a page that starts the Spotify app (home-screen apps and Telegram won't).
  Serving that page is up to the app.
- `pickCover(artUrls)` returns a cover at a hotlink-friendly size.
- Lower level: `detect`, `unshorten`, `readers`, `enrich`, `buildLinks`,
  `expand` (Squigly), the parsers, `sameWork`, and `get`/`getJson`/`getPage`
  (the safe fetch).

## Installing

Install a tagged release as a tarball, which needs no git in the build image:

```sh
npm install https://github.com/rahulahoop/musiclinks/archive/refs/tags/v1.0.0.tar.gz
```

Changes reach an app only when it moves to a new tag.

## Development

```sh
npm test
```
