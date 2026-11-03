// musiclinks: a music link (or "artist title" text) in, everything about it out,
// with the same record on every streaming service.
export { configure } from './src/config.js'
export { resolve } from './src/resolve.js'
export { buildLinks, enrich, isMusic, openLink, PLATFORM_NAMES, searchDeezer, searchItunes } from './src/enrich.js'
export { detect, fromUrl, readers, unshorten } from './src/sources.js'
export { expand, parseSquigly } from './src/squigly.js'
export { assertPublic, get, getJson, getPage } from './src/http.js'
export { decodeEntities, normal, parseInput, sameWork, slugTitle, splitTitle, stripHtml } from './src/text.js'
export * from './src/parsers.js'
export { pickCover } from './src/cover.js'
