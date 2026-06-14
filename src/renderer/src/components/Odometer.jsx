import { useEffect, useRef, useState } from 'react'
import { formatUSD } from '../lib/pricing'

// Tweens a numeric value to its new target over ~400ms (rolling cost).
export default function Odometer({ value }) {
  const [display, setDisplay] = useState(value || 0)
  const fromRef = useRef(value || 0)
  const rafRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const to = value || 0
    if (from === to) return
    const start = performance.now()
    const dur = 400
    cancelAnimationFrame(rafRef.current)
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur)
      setDisplay(from + (to - from) * p)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value])
  return <span className="odometer">{formatUSD(display)}</span>
}
