import { useEffect } from 'react'

// Full-size image overlay. Click anywhere or press Esc to close.
export default function Lightbox({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!item) return null
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={`data:${item.mediaType};base64,${item.data}`} alt="session image (full size)" />
    </div>
  )
}
