import { useState, useEffect } from 'react'

// Shell profiles live in main (settings.json) and are managed via window.flux.settings.
export default function TerminalSection() {
  const [profiles, setProfiles] = useState([])
  const refresh = () => window.flux.settings.profiles().then(setProfiles)
  useEffect(() => { refresh() }, [])

  const add = async () => {
    await window.flux.settings.saveProfile({ name: 'New profile', shell: null, args: [], cwd: null })
    refresh()
  }
  const rename = async (p, name) => { await window.flux.settings.saveProfile({ ...p, name }); refresh() }
  const del = async (id) => { await window.flux.settings.deleteProfile(id); refresh() }

  return (
    <div>
      <div className="set-h">Terminal</div>
      <div className="set-sub">Shell profiles available in the terminal tab launcher.</div>
      <div className="set-sec-label">Profiles</div>
      {profiles.map((p) => (
        <div className="set-row" key={p.id}>
          <input
            className="settings-search"
            style={{ margin: 0, flex: 1 }}
            value={p.name}
            onChange={(e) => rename(p, e.target.value)}
          />
          <button className="set-seg-btn" onClick={() => del(p.id)} title="Delete profile">✕</button>
        </div>
      ))}
      <button className="set-test-btn" onClick={add}>+ Add profile</button>
    </div>
  )
}
