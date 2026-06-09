import { useEffect, useState, useCallback } from 'react'

// Shared plan-usage state: initial fetch + push updates from the main-process
// poller. Multiple components can use this hook; they stay in sync because all
// instances subscribe to the same usage:update events.
export function useUsage() {
  const [usage, setUsage] = useState(null)

  useEffect(() => {
    let alive = true
    window.flux.usage.get().then((u) => {
      if (alive && u) setUsage(u)
    })
    const off = window.flux.usage.onUpdate(setUsage)
    return () => {
      alive = false
      off()
    }
  }, [])

  const refresh = useCallback(() => {
    window.flux.usage.refresh()
  }, [])

  return { usage, refresh }
}
