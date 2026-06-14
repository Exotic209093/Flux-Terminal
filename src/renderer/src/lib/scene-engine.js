// One Canvas-2D animation loop shared by all scenes. DPR-aware, paused when the
// document is hidden, and resilient to resize. Scenes are factories registered
// by theme key. No dependencies.

function createEngine(canvas, registry) {
  const ctx = canvas.getContext('2d')
  let scene = null
  let raf = 0
  let running = false
  let dim = { w: 0, h: 0 }

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    dim = { w, h }
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (scene && scene.resize) scene.resize(dim)
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => size()) : null
  if (ro) ro.observe(canvas)
  else window.addEventListener('resize', size)

  const onVis = () => {
    if (document.hidden) pause()
    else if (scene) start()
  }
  document.addEventListener('visibilitychange', onVis)

  function frame(t) {
    if (!running) return
    raf = requestAnimationFrame(frame)
    if (scene && scene.draw) scene.draw(t, dim)
  }
  function start() {
    if (running || !scene) return
    running = true
    size()
    raf = requestAnimationFrame(frame)
  }
  function pause() {
    running = false
    cancelAnimationFrame(raf)
  }
  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
  function setScene(key) {
    const factory = registry && registry[key]
    pause()
    clear()
    scene = factory ? factory(ctx) : null
    if (scene) {
      size()
      start()
    }
  }
  function stop() {
    pause()
    clear()
  }
  function destroy() {
    pause()
    if (ro) ro.disconnect()
    else window.removeEventListener('resize', size)
    document.removeEventListener('visibilitychange', onVis)
    scene = null
  }

  return { setScene, start, stop, destroy }
}

export { createEngine }
