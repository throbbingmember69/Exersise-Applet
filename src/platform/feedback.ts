// Haptic and audio feedback. Both need a prior user gesture on Android Chrome: call
// `unlockAudio()` from a tap (e.g. "Start workout") before the first beep.

/** Vibrate if supported (Android). Returns whether the call was accepted. */
export function vibrate(pattern: number | number[], nav: Navigator = navigator): boolean {
  try {
    return typeof nav.vibrate === 'function' ? nav.vibrate(pattern) : false
  } catch {
    return false
  }
}

type AudioCtor = typeof AudioContext

let audio: AudioContext | null = null

function audioCtor(): AudioCtor | null {
  const w = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/** Create/resume the shared AudioContext. Must run inside a user gesture the first time. */
export async function unlockAudio(): Promise<boolean> {
  const Ctor = audioCtor()
  if (!Ctor) return false
  try {
    audio ??= new Ctor()
    if (audio.state === 'suspended') await audio.resume()
    return audio.state === 'running'
  } catch {
    return false
  }
}

/** A short two-tone beep. Silently does nothing when audio isn't available or unlocked. */
export function beep(): void {
  if (!audio || audio.state !== 'running') return
  const t0 = audio.currentTime
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const start = t0 + i * 0.18
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
    osc.connect(gain).connect(audio.destination)
    osc.start(start)
    osc.stop(start + 0.17)
  }
}

/** Test hook: forget the shared AudioContext. */
export function resetAudioForTests(): void {
  audio = null
}
