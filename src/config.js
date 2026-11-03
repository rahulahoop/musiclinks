// Settings shared by every module. Apps call configure() once at startup.
export const settings = {
  // One honest identity per app. A site that refuses it gets left alone: the
  // caller falls back to what the URL itself says.
  userAgent: 'musiclinks/1 (+https://github.com/rahulahoop/musiclinks)',
  // (service, outcome) for every match tried, e.g. a Prometheus counter.
  onLookup: null,
}

export function configure({ userAgent, onLookup } = {}) {
  if (userAgent !== undefined) settings.userAgent = userAgent
  if (onLookup !== undefined) settings.onLookup = onLookup
}

export function countLookup(service, outcome) {
  try {
    settings.onLookup?.(service, outcome)
  } catch {}
}
