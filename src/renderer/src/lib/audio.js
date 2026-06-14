// Tiny WebAudio event cues. AudioContext created lazily (first call after a
// user gesture). No-op where unsupported.
let ctx = null
function ac() {
  if (ctx) return ctx
  try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { ctx = null }
  return ctx
}
const CUES = { 'turn:finished': [660, 0.12], 'turn:error': [220, 0.22], blocked: [440, 0.16] }
function playCue(type) {
  const a = ac()
  const spec = CUES[type]
  if (!a || !spec) return
  try {
    const [freq, dur] = spec
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, a.currentTime)
    g.gain.exponentialRampToValueAtTime(0.15, a.currentTime + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur)
    o.connect(g)
    g.connect(a.destination)
    o.start()
    o.stop(a.currentTime + dur)
  } catch {
    /* ignore */
  }
}
export { playCue }
