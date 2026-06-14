import { reactiveSpeed } from '../reactivity.js'

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺ0123456789ABCDEF'
const FONT = 14

function create(ctx) {
  let cols = 0
  let drops = []
  let last = 0
  function resize(dim) {
    cols = Math.max(1, Math.floor(dim.w / FONT))
    drops = Array.from({ length: cols }, () => Math.random() * (dim.h / FONT))
  }
  function draw(t, dim, reactivity = {}) {
    if (t - last < 42) return // ~24fps
    last = t
    const tps = (reactivity || {}).tokensPerSec || 0
    const step = reactiveSpeed(1, tps)
    ctx.fillStyle = 'rgba(5, 10, 5, 0.18)'
    ctx.fillRect(0, 0, dim.w, dim.h)
    ctx.fillStyle = '#39ff14'
    ctx.font = FONT + 'px monospace'
    for (let i = 0; i < cols; i++) {
      ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * FONT, drops[i] * FONT)
      if (drops[i] * FONT > dim.h && Math.random() > 0.975) drops[i] = 0
      drops[i] += step
    }
  }
  return { draw, resize }
}

export { create }
