import { parseInput, splitTitle } from './text.js'
import { detect, fromUrl, readers, unshorten } from './sources.js'
import { buildLinks, enrich, searchItunes } from './enrich.js'

// Plain text ("radiohead weird fishes"): best guess from the Apple catalogue.
async function fromSearch(text) {
  const hit = (await searchItunes(text, 'song'))[0]
  if (hit) return { item: hit, url: hit.link, source: 'apple' }
  const { title, artist } = splitTitle(text)
  return { item: { kind: 'track', title, artist, artUrls: [], meta: {}, incomplete: true }, url: null, source: 'text' }
}

export async function resolve(input) {
  const { url: pasted, rest } = parseInput(input)
  if (!pasted && !rest) throw new Error('nothing to look up')

  let found
  if (pasted) {
    const url = await unshorten(pasted)
    const source = detect(url)
    try {
      found = { item: await readers[source](url), url, source }
    } catch (e) {
      console.error(`[resolve] ${source}: ${e.message}`)
      found = { item: fromUrl(url, source), url, source }
    }
    if (!found.item.title) found.item = { ...fromUrl(url, source), ...found.item, title: fromUrl(url, source).title, incomplete: true }
  } else {
    found = await fromSearch(rest)
  }

  const { item, url, source } = found
  item.meta ??= {}
  item.artUrls ??= []
  const exact = await enrich(item, url, source)
  // Text around a link names a page that couldn't be read; otherwise it's a note.
  let note = pasted ? rest : ''
  if (item.incomplete && note) {
    Object.assign(item, splitTitle(note), { incomplete: false })
    note = ''
  }
  return { ...item, url, source, note, links: buildLinks(item, source, url, exact) }
}
