import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { settings } from './config.js'

const TIMEOUT = 12_000
const MAX_REDIRECTS = 5

function isPrivate(ip) {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase()
    if (v6.startsWith('::ffff:')) return isPrivate(v6.slice(7))
    return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)
  }
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

// Links come from people, so they must never reach the server's own services or
// a private network.
export async function assertPublic(url) {
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('not a web link')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (addrs.some((a) => isPrivate(a.address))) throw new Error('not a public address')
}

// fetch with manual redirects, so every hop gets the same check.
export async function get(url, { headers = {}, accept = '*/*' } = {}) {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(current)
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': settings.userAgent, Accept: accept, ...headers },
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href
      continue
    }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} from ${new URL(current).hostname}`), { status: res.status })
    return Object.assign(res, { finalUrl: current })
  }
  throw new Error('too many redirects')
}

export const getJson = (url, opts) => get(url, { accept: 'application/json', ...opts }).then((r) => r.json())

export async function getPage(url) {
  const res = await get(url, { accept: 'text/html,application/xhtml+xml' })
  return { html: await res.text(), url: res.finalUrl }
}
