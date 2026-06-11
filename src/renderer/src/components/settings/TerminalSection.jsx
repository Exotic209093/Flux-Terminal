import { useState, useEffect } from 'react'

function ProfileRow({ profile, onSave, onDelete }) {
  const [name, setName] = useState(profile.name)
  useEffect(() => { setName(profile.name) }, [profile.name])
  const handleBlur = () => { if (name !== profile.name) onSave({ ...profile, name }) }
  return (
    <div className="set-row">
      <input
        className="settings-search"
        style={{ margin: 0, flex: 1 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={handleBlur}
      />
      <button className="set-seg-btn" onClick={() => onDelete(profile.id)} title="Delete profile">✕</button>
    </div>
  )
}

export default function TerminalSection() {
  const [profiles, setProfiles] = useState([])
  const refresh = () => window.flux.settings.profiles().then(setProfiles).catch(console.error)
  useEffect(() => { refresh() }, [])

  const add = () =>
    window.flux.settings.saveProfile({ name: 'New profile', shell: null, args: [], cwd: null }).then(refresh).catch(console.error)
  const save = (p) => window.flux.settings.saveProfile(p).then(refresh).catch(console.error)
  const del = (id) => window.flux.settings.deleteProfile(id).then(refresh).catch(console.error)

  return (
    <div>
      <div className="set-h">Terminal</div>
      <div className="set-sub">Shell profiles available in the terminal tab launcher.</div>
      <div className="set-sec-label">Profiles</div>
      {profiles.map((p) => (
        <ProfileRow key={p.id} profile={p} onSave={save} onDelete={del} />
      ))}
      <button className="set-test-btn" onClick={add}>+ Add profile</button>
    </div>
  )
}
