import { useEffect, useRef } from 'react'
import { isAnimated } from '../lib/themes'

// Fixed star positions for the Nebula theme (left, top, animation-delay).
const STARS = [
  ['12%', '18%', '0s'], ['28%', '9%', '0.6s'], ['44%', '24%', '1.2s'],
  ['61%', '13%', '0.3s'], ['77%', '28%', '1.5s'], ['88%', '16%', '0.9s'],
  ['20%', '54%', '1.1s'], ['38%', '69%', '0.4s'], ['67%', '61%', '1.7s'],
  ['83%', '73%', '0.8s'], ['52%', '84%', '1.3s'], ['9%', '78%', '0.2s']
]

// Classic falling-glyph "Matrix rain" on a canvas. Throttled to ~24fps and
// paused while the window is hidden so it costs nothing in the background.
function useMatrixRain(canvasRef, enabled) {
  useEffect(() => {
    if (!enabled) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const FONT = 14
    const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺ0123456789ABCDEF'
    let cols = 0
    let drops = []
    let raf = 0
    let last = 0
    let running = true

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      cols = Math.max(1, Math.floor(canvas.width / FONT))
      drops = Array.from({ length: cols }, () => Math.random() * (canvas.height / FONT))
    }

    const frame = (t) => {
      if (!running) return
      raf = requestAnimationFrame(frame)
      if (t - last < 42) return // ~24fps
      last = t
      ctx.fillStyle = 'rgba(5, 10, 5, 0.16)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#39ff14'
      ctx.font = FONT + 'px monospace'
      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        ctx.fillText(ch, i * FONT, drops[i] * FONT)
        if (drops[i] * FONT > canvas.height && Math.random() > 0.975) drops[i] = 0
        drops[i]++
      }
    }

    const onVisibility = () => {
      running = !document.hidden
      if (running) raf = requestAnimationFrame(frame)
    }

    resize()
    raf = requestAnimationFrame(frame)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [canvasRef, enabled])
}

export default function ThemeBackground({ theme, animated }) {
  const canvasRef = useRef(null)
  const matrixOn = theme === 'matrix' && animated && isAnimated(theme)
  useMatrixRain(canvasRef, matrixOn)

  // CSS (via html[data-anim]) hides this layer entirely when animation is off,
  // so we can always render it; structural children are theme-specific.
  return (
    <div className="theme-bg" aria-hidden="true">
      {theme === 'nebula' &&
        STARS.map(([left, top, delay], i) => (
          <span className="star" key={i} style={{ left, top, animationDelay: delay }} />
        ))}
      {theme === 'synthwave' && (
        <>
          <div className="sun" />
          <div className="grid" />
        </>
      )}
      {theme === 'matrix' && <canvas ref={canvasRef} className="matrix-canvas" />}
    </div>
  )
}
