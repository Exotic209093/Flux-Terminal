import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// NOTE: intentionally not wrapped in <React.StrictMode>. StrictMode double-
// invokes effects in dev, which would spawn the PTY twice. Revisit once the
// terminal lifecycle is fully idempotent.
createRoot(document.getElementById('root')).render(<App />)
