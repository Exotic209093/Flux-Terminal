import { useEffect, useRef } from 'react'
import { isAnimated } from '../lib/themes'
import { createEngine } from '../lib/scene-engine'
import { create as aurora } from '../lib/scenes/aurora'
import { create as nebula } from '../lib/scenes/nebula'
import { create as synthwave } from '../lib/scenes/synthwave'
import { create as matrix } from '../lib/scenes/matrix'
import { tokensPerSecFrom } from '../lib/reactivity'

const REGISTRY = { aurora, nebula, synthwave, matrix }

export default function ThemeBackground({ theme, animated, live }) {
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const prevRef = useRef({ tokens: 0, ts: 0 })
  const flareRef = useRef(0)

  useEffect(() => {
    if (!canvasRef.current) return
    engineRef.current = createEngine(canvasRef.current, REGISTRY)
    return () => { engineRef.current && engineRef.current.destroy(); engineRef.current = null }
  }, [])

  useEffect(() => {
    const e = engineRef.current
    if (!e) return
    if (animated && isAnimated(theme)) e.setScene(theme)
    else e.stop()
  }, [theme, animated])

  useEffect(() => {
    const e = engineRef.current
    if (!e) return
    const u = live && live.usage
    const tokens = u ? (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheCreation || 0) : 0
    const ts = Date.now()
    const prev = prevRef.current
    const tps = tokensPerSecFrom(prev.tokens, prev.ts, tokens, ts)
    prevRef.current = { tokens, ts }
    if (live && (live.state === 'error' || live.hasError)) flareRef.current = 1
    else flareRef.current = Math.max(0, flareRef.current - 0.15)
    e.setReactivity({ tokensPerSec: tps, flare: flareRef.current })
    const pulse = Math.min(1, tps / 80)
    document.documentElement.style.setProperty('--pulse', String(pulse.toFixed(3)))
  }, [live])

  return <canvas ref={canvasRef} className="theme-bg-canvas" aria-hidden="true" />
}
