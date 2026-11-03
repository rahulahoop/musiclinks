// Covers that get hotlinked rather than downloaded: a sensible size instead of
// the 3000px original. Takes resolve()'s artUrls, best first.
export function pickCover(urls = []) {
  const sized = urls.map((u) => u
    .replace(/(mzstatic\.com\/.*\/)\d+x\d+bb\.(jpg|png|webp)$/, '$1600x600bb.$2')
    .replace(/(bcbits\.com\/img\/.*)_\d+\.jpg$/, '$1_16.jpg'))
  return sized.find((u) => u.startsWith('https://')) ?? null
}
