// Retro sun (scanline cutouts) on a glowing horizon + perspective grid + stars.
function makeStars(n, dim) {
  return Array.from({ length: n }, () => ({ x: Math.random() * dim.w, y: Math.random() * dim.h * 0.55 }))
}

function create(ctx) {
  let stars = []
  function resize(d) { stars = makeStars(Math.max(30, Math.floor(d.w / 12)), d) }
  function draw(t, d, reactivity = {}) {
    const flare = Math.max(0, (reactivity || {}).flare || 0)
    const horizon = d.h * 0.6
    // sky gradient
    let g = ctx.createLinearGradient(0, 0, 0, horizon)
    g.addColorStop(0, '#1a1025'); g.addColorStop(1, '#3a1d4d')
    ctx.fillStyle = g; ctx.fillRect(0, 0, d.w, horizon)
    // stars
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    for (const s of stars) ctx.fillRect(s.x, s.y, 1.5, 1.5)
    // sun
    const cx = d.w / 2, cy = horizon - 60, r = Math.min(120, d.w * 0.12)
    if (flare > 0.05) {
      // radial glow behind sun on error/activity
      const rg = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 2.5)
      rg.addColorStop(0, `rgba(255,120,60,${(flare * 0.25).toFixed(3)})`)
      rg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = rg; ctx.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6)
    }
    const sg = ctx.createLinearGradient(cx, cy - r, cx, cy + r)
    sg.addColorStop(0, '#ff8a3d'); sg.addColorStop(1, '#ff2fb0')
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip()
    ctx.fillStyle = sg; ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.fillStyle = '#1a1025'
    for (let i = 0; i < 8; i++) { const yy = cy + i * 9 - 4; if (yy > cy - r) ctx.fillRect(cx - r, yy, r * 2, 3 + i) }
    ctx.restore()
    // ground
    ctx.fillStyle = '#160a22'; ctx.fillRect(0, horizon, d.w, d.h - horizon)
    // perspective grid
    ctx.strokeStyle = 'rgba(54,224,255,0.5)'; ctx.lineWidth = 1
    const vp = cx
    for (let i = -10; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(vp + i * 40, horizon); ctx.lineTo(vp + i * 400, d.h); ctx.stroke() }
    const scroll = (t * 0.06) % 40
    for (let y = 0; y < d.h - horizon; y += 4) {
      const yy = horizon + ((y + scroll) * (y + scroll)) / (d.h - horizon)
      if (yy > d.h) break
      ctx.globalAlpha = 0.2 + 0.5 * (yy - horizon) / (d.h - horizon)
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(d.w, yy); ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  return { draw, resize }
}

export { create, makeStars }
