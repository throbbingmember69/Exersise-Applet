// YouTube links for in-app form videos: find the video id (and start time) in the usual URL forms,
// and build the privacy-enhanced embed URL (youtube-nocookie.com: no cookies until playback).

const ID = /^[\w-]{11}$/
const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
])

export interface YouTubeVideo {
  id: string
  /** Start offset in seconds (from t= or start=), or 0. */
  startSec: number
}

/** "90", "90s", "1m30s", "1h2m3s" → seconds; anything else → 0. */
function parseStart(value: string | null): number {
  if (!value) return 0
  if (/^\d+$/.test(value)) return Number(value)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
  if (!m || value === '') return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

/** The video in a YouTube link (watch, youtu.be, shorts, embed, live), or null for other links. */
export function parseYouTubeUrl(url: string): YouTubeVideo | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  if (!HOSTS.has(host)) return null
  const path = u.pathname.split('/').filter(Boolean)
  let id: string | null = null
  if (host === 'youtu.be') id = path[0] ?? null
  else if (path[0] === 'watch') id = u.searchParams.get('v')
  else if (['shorts', 'embed', 'live', 'v'].includes(path[0] ?? '')) id = path[1] ?? null
  if (!id || !ID.test(id)) return null
  return { id, startSec: parseStart(u.searchParams.get('t') ?? u.searchParams.get('start')) }
}

/** The embed player URL for a video (plays inline on phones; no unrelated suggestions). */
export function youtubeEmbedUrl(video: YouTubeVideo, opts: { autoplay?: boolean } = {}): string {
  const params = new URLSearchParams({ rel: '0', playsinline: '1', modestbranding: '1' })
  if (opts.autoplay) params.set('autoplay', '1')
  if (video.startSec > 0) params.set('start', String(video.startSec))
  return `https://www.youtube-nocookie.com/embed/${video.id}?${params.toString()}`
}
