export type Kind = 'track' | 'album' | 'mix' | 'show' | 'episode' | 'playlist' | 'page'

/** spotify, apple, youtube, tidal, qobuz, deezer, amazon, bandcamp, soundcloud, mixcloud, rte, web, squigly */
export type Platform = string

export interface Link {
  platform: Platform
  /** Display name, e.g. "Apple Music". */
  name: string
  url: string
  /** true: this exact record. false: a search on that service. */
  exact: boolean
}

export interface Meta {
  released?: string
  genre?: string
  label?: string
  tracks?: number
  trackNo?: number
  disc?: number
  seconds?: number
  bpm?: number
  explicit?: boolean
  isrc?: string
  upc?: string
  tags?: string[]
  description?: string
  [key: string]: unknown
}

export interface Item {
  kind: Kind
  title: string
  artist?: string
  album?: string
  /** Cover candidates, best first. */
  artUrls: string[]
  meta: Meta
  /** The page couldn't be read; title/artist come from the URL alone. */
  incomplete?: boolean
}

export interface Resolved extends Item {
  /** The pasted link after unshortening, or the matched one for plain text. */
  url: string | null
  /** Platform the input came from ('text' for a plain-text search). */
  source: string
  /** Text around the link that wasn't needed to name the record. */
  note: string
  /** Source first, then exact links, then searches on the remaining services. */
  links: Link[]
}

export interface Settings {
  /** Sent on every request. Name your app and give a contact URL. */
  userAgent?: string
  /** Called for every match tried; outcome is 'hit', 'miss' or 'error'. */
  onLookup?: ((service: string, outcome: 'hit' | 'miss' | 'error') => void) | null
}

export function configure(settings: Settings): void

/** A link anywhere in the text, or "artist title" text. Never rejects for a readable link: it degrades to what the URL says. */
export function resolve(input: string): Promise<Resolved>

/** Route exact Spotify links through `${base}/s/<type>/<id>`; anything else is returned unchanged. */
export function openLink(url: string, base?: string): string
/** Pick a hotlink-sized cover from artUrls. */
export function pickCover(urls?: string[]): string | null

export const PLATFORM_NAMES: Record<string, string>
export function buildLinks(item: Item, source: string, url: string | null, exact?: Record<string, string>): Link[]
export function enrich(item: Item, url: string | null, source: string): Promise<Record<string, string>>
export function isMusic(item: Item): boolean
export function detect(url: string): Platform
export function fromUrl(url: string, source: string): Item
export function unshorten(url: string): Promise<string>

export function parseInput(input: string): { url: string | null; rest: string }
export function splitTitle(text: string): { title: string; artist?: string }
export function sameWork(a: { title?: string; artist?: string }, b: { title?: string; artist?: string }): boolean
export function normal(s: string): string
export function stripHtml(s: string): string
export function decodeEntities(s: string): string
export function slugTitle(url: string): string

/** fetch with redirects followed by hand, refusing private and loopback addresses at every hop. */
export function get(url: string, options?: { headers?: Record<string, string>; accept?: string }): Promise<Response & { finalUrl: string }>
export function getJson(url: string, options?: { headers?: Record<string, string> }): Promise<any>
export function getPage(url: string): Promise<{ html: string; url: string }>
export function assertPublic(url: string): Promise<void>
