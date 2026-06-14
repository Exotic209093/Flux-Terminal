import { useEffect, useRef } from 'react'
import { isAnimated } from '../lib/themes'
import { createEngine } from '../lib/scene-engine'
import { create as aurora } from '../lib/scenes/aurora'
import { create as nebula } from '../lib/scenes/nebula'
import { create as synthwave } from '../lib/scenes/synthwave'
import { create as matrix } from '../lib/scenes/matrix'

const REGISTRY = { aurora, nebula, synthwave, matrix }

export default function ThemeBackground({ theme, animated }) {
  const canvasRef = useRef(null)
  const engineRef = useRef(null)

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

  return <canvas ref={canvasRef} className="theme-bg-canvas" aria-hidden="true" />
}
