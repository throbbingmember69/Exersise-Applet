import { describe, expect, it } from 'vitest'
import { parseYouTubeUrl, youtubeEmbedUrl } from './youtube'

describe('parseYouTubeUrl', () => {
  it('reads the usual YouTube link forms', () => {
    const id = 'fEuYM-miK5U'
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://m.youtube.com/watch?v=${id}&feature=share`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      ` http://youtube.com/watch?v=${id} `,
    ]) {
      expect(parseYouTubeUrl(url), url).toEqual({ id, startSec: 0 })
    }
  })

  it('keeps a start time', () => {
    expect(parseYouTubeUrl('https://youtu.be/fEuYM-miK5U?t=95')?.startSec).toBe(95)
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=fEuYM-miK5U&t=1m30s')?.startSec).toBe(
      90,
    )
    expect(parseYouTubeUrl('https://www.youtube.com/embed/fEuYM-miK5U?start=12')?.startSec).toBe(12)
    expect(parseYouTubeUrl('https://youtu.be/fEuYM-miK5U?t=soon')?.startSec).toBe(0)
  })

  it('rejects other sites, bad ids and non-web links', () => {
    for (const url of [
      'https://vimeo.com/123456',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/results?search_query=squat',
      'https://notyoutube.com/watch?v=fEuYM-miK5U',
      'javascript:alert(1)',
      'not a link',
    ]) {
      expect(parseYouTubeUrl(url), url).toBeNull()
    }
  })
})

describe('youtubeEmbedUrl', () => {
  it('builds the privacy-enhanced embed URL', () => {
    expect(youtubeEmbedUrl({ id: 'fEuYM-miK5U', startSec: 0 })).toBe(
      'https://www.youtube-nocookie.com/embed/fEuYM-miK5U?rel=0&playsinline=1&modestbranding=1',
    )
    expect(youtubeEmbedUrl({ id: 'fEuYM-miK5U', startSec: 90 }, { autoplay: true })).toBe(
      'https://www.youtube-nocookie.com/embed/fEuYM-miK5U?rel=0&playsinline=1&modestbranding=1&autoplay=1&start=90',
    )
  })
})
