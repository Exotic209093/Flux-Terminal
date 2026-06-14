// Undulating aurora ribbons (additive) + rising motes.
function makeMotes(n, dim) {
  return Array.from({ length: n }, () => ({ x: Math.random() * dim.w, y: Math.random() * dim.h, r: 1 + Math.random() * 2, s: 0.2 + Math.random() * 0.6 }))
}

function create(ctx) {
  let dim = { w: 0, h: 0 }
  let motes = []
  const bands = [
    { color: '94,234,212', y: 0.35, amp: 0.10, speed: 0.00018, k: 1.3 },
    { color: '167,139,250', y: 0.5, amp: 0.13, speed: 0.00012, k: 0.9 },
    { color: '56,189,170', y: 0.62, amp: 0.08, speed: 0.00022, k: 1.7 }
  ]
  function resize(d) { dim = d; motes = makeMotes(Math.max(20, Math.floor(d.w * d.h / 26000)), d) }
  function draw(t, d, reactivity = {}) {
    dim = d
    const flare = Math.max(0, (reactivity || {}).flare || 0)
    ctx.clearRect(0, 0, d.w, d.h)
    ctx.globalCompositeOperation = 'lighter'
    for (const b of bands) {
      ctx.beginPath()
      for (let x = 0; x <= d.w; x += 12) {
        const y = d.h * b.y + Math.sin(x * 0.008 * b.k + t * b.speed) * d.h * b.amp + Math.sin(x * 0.02 + t * b.speed * 2) * 14
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.lineTo(d.w, d.h); ctx.lineTo(0, d.h); ctx.closePath()
      const alpha = (0.22 + flare * 0.18).toFixed(3)
      const g = ctx.createLinearGradient(0, d.h * (b.y - b.amp), 0, d.h)
      g.addColorStop(0, `rgba(${b.color},${alpha})`); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.fill()
    }
    if (flare > 0.05) {
      // brief radial flare at top-centre on error
      const rx = d.w * 0.5, ry = d.h * 0.2
      const rg = ctx.createRadialGradient(rx, ry, 0, rx, ry, d.w * 0.3)
      rg.addColorStop(0, `rgba(255,220,180,${(flare * 0.12).toFixed(3)})`)
      rg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = rg; ctx.fillRect(0, 0, d.w, d.h)
    }
    for (const m of motes) {
      m.y -= m.s; if (m.y < -4) { m.y = d.h + 4; m.x = Math.random() * d.w }
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.fillStyle = 'rgba(180,255,235,0.5)'; ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }
  return { draw, resize }
}

export { create, makeMotes }
