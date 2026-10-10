import { describe, expect, it } from 'vitest'
import { FORM_GUIDES, formGuideFor, youtubeSearchUrl } from './formGuides'
import { SEED } from './index'

describe('form guides', () => {
  it('cover every library exercise with a YouTube video and 3–4 short cues', () => {
    for (const e of SEED.exercises) {
      const guide = FORM_GUIDES[e.id]
      expect(guide, e.id).toBeDefined()
      expect(guide!.videoUrl, e.id).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/)
      expect(guide!.title.length, e.id).toBeGreaterThan(0)
      expect(guide!.channel.length, e.id).toBeGreaterThan(0)
      expect(guide!.cues.length, e.id).toBeGreaterThanOrEqual(3)
      expect(guide!.cues.length, e.id).toBeLessThanOrEqual(4)
      for (const cue of guide!.cues) expect(cue.length, cue).toBeLessThan(100)
    }
    // No guide without an exercise, and no video used twice.
    const ids = new Set(SEED.exercises.map((e) => e.id))
    expect(Object.keys(FORM_GUIDES).filter((id) => !ids.has(id))).toEqual([])
    const videos = Object.values(FORM_GUIDES).map((g) => g.videoUrl)
    expect(new Set(videos).size).toBe(videos.length)
  })

  it('prefers the user’s link, then the curated video, then a YouTube search', () => {
    const curated = FORM_GUIDES['ex-hip-abduction']!
    expect(formGuideFor({ id: 'ex-hip-abduction', name: 'Hip abduction', formUrl: null })).toEqual({
      ...curated,
      source: 'curated',
      embed: { id: '2b97cvyH9sE', startSec: 0 },
    })
    expect(
      formGuideFor({ id: 'ex-hip-abduction', name: 'Hip abduction', formUrl: 'https://x.test/v' }),
    ).toEqual({
      videoUrl: 'https://x.test/v',
      source: 'yours',
      title: null,
      channel: null,
      cues: curated.cues,
      embed: null,
    })
    // The user's own YouTube link plays in the app too, from its start time.
    expect(
      formGuideFor({
        id: 'ex-hip-abduction',
        name: 'Hip abduction',
        formUrl: 'https://youtu.be/abcdefghijk?t=45',
      }).embed,
    ).toEqual({ id: 'abcdefghijk', startSec: 45 })
    expect(formGuideFor({ id: 'ex-user-1', name: 'Pendulum squat', formUrl: null })).toEqual({
      videoUrl: youtubeSearchUrl('Pendulum squat'),
      source: 'search',
      title: null,
      channel: null,
      cues: [],
      embed: null,
    })
    // Every curated video plays in the app.
    for (const [id, g] of Object.entries(FORM_GUIDES)) {
      expect(formGuideFor({ id, name: id, formUrl: null }).embed, id).not.toBeNull()
      expect(g.videoUrl).toContain(formGuideFor({ id, name: id, formUrl: null }).embed!.id)
    }
    expect(youtubeSearchUrl('Pendulum squat')).toBe(
      'https://www.youtube.com/results?search_query=Pendulum%20squat%20proper%20form',
    )
  })
})
