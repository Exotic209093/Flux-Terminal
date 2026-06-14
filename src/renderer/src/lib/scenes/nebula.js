// Parallax starfield + drifting nebula blobs + occasional shooting star.
function makeStars(n, dim) {
  return Array.from({ length: n }, () => ({ x: Math.random() * dim.w, y: Math.random() * dim.h, z: 0.3 + Math.random() * 0.7, p: Math.random() * 6.28 }))
}

function create(ctx) {
  let stars = []
  let shoot = null
  let nextShoot = 2000
  function resize(d) { stars = makeStars(Math.max(40, Math.floor(d.w * d.h / 9000)), d) }
  function draw(t, d) {
    ctx.fillStyle = 'rgba(7,6,18,0.4)'; ctx.fillRect(0, 0, d.w, d.h)
    ctx.globalCompositeOperation = 'lighter'
    // nebula blobs
    for (let i = 0; i < 3; i++) {
      const cx = d.w * (0.3 + 0.2 * i) + Math.sin(t * 0.00005 + i) * 60
      const cy = d.h * (0.4 + 0.15 * i) + Math.cos(t * 0.00004 + i) * 40
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, d.w * 0.25)
      g.addColorStop(0, i % 2 ? 'rgba(139,156,255,0.06)' : 'rgba(214,139,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, d.w, d.h)
    }
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * 0.003 * s.z + s.p)
      ctx.globalAlpha = tw * s.z
      ctx.fillStyle = '#e6e3ff'; ctx.fillRect(s.x, s.y, s.z * 1.6, s.z * 1.6)
    }
    ctx.globalAlpha = 1
    if (t > nextShoot && !shoot) { shoot = { x: Math.random() * d.w, y: Math.random() * d.h * 0.5, life: 0 }; nextShoot = t + 3000 + Math.random() * 4000 }
    if (shoot) {
      shoot.life += 16; const len = 120
      const x2 = shoot.x + shoot.life * 0.6, y2 = shoot.y + shoot.life * 0.3
      const g = ctx.createLinearGradient(x2 - len, y2 - len * 0.5, x2, y2)
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.9)')
      ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x2 - len, y2 - len * 0.5); ctx.lineTo(x2, y2); ctx.stroke()
      if (shoot.life > 400) shoot = null
    }
    ctx.globalCompositeOperation = 'source-over'
  }
  return { draw, resize }
}

export { create, makeStars }
