import { useState, useEffect } from 'react'

function ProfileRow({ profile, onSave, onDelete }) {
  const [name, setName] = useState(profile.name)
  const [cwd, setCwd] = useState(profile.cwd || '')
  const [shell, setShell] = useState(profile.shell || '')
  const [argsStr, setArgsStr] = useState((profile.args || []).join(' '))
  const [tracked, setTracked] = useState(!!profile.tracked)

  useEffect(() => { setName(profile.name) }, [profile.name])
  useEffect(() => { setCwd(profile.cwd || '') }, [profile.cwd])
  useEffect(() => { setShell(profile.shell || '') }, [profile.shell])
  useEffect(() => { setArgsStr((profile.args || []).join(' ')) }, [profile.args])
  useEffect(() => { setTracked(!!profile.tracked) }, [profile.tracked])

  const save = (overrides) => onSave({ ...profile, name, cwd: cwd || null, shell: shell || null, args: argsStr.trim() ? argsStr.trim().split(/\s+/) : [], tracked, ...overrides })

  return (
    <div className="profile-card">
      <div className="profile-card-header">
        <input
          className="settings-search"
          style={{ margin: 0, flex: 1 }}
          placeholder="Profile name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => save({ name })}
        />
        <button className="set-seg-btn" onClick={() => onDelete(profile.id)} title="Delete profile">✕</button>
      </div>
      <div className="profile-field">
        <label className="profile-field-label">Working directory</label>
        <input
          className="settings-search profile-field-input"
          placeholder="Default (home)"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          onBlur={() => save({ cwd: cwd || null })}
        />
      </div>
      <div className="profile-field">
        <label className="profile-field-label">Shell</label>
        <input
          className="settings-search profile-field-input"
          placeholder="Default (PowerShell)"
          value={shell}
          onChange={(e) => setShell(e.target.value)}
          onBlur={() => save({ shell: shell || null })}
        />
      </div>
      <div className="profile-field">
        <label className="profile-field-label">Launch args</label>
        <input
          className="settings-search profile-field-input"
          placeholder="e.g. -NoLogo -NoProfile"
          value={argsStr}
          onChange={(e) => setArgsStr(e.target.value)}
          onBlur={() => save({ args: argsStr.trim() ? argsStr.trim().split(/\s+/) : [] })}
        />
      </div>
      <div className="profile-field profile-field-check">
        <label className="profile-field-label">Tracked (open as Claude session)</label>
        <input
          type="checkbox"
          className="profile-check"
          checked={tracked}
          onChange={(e) => { setTracked(e.target.checked); save({ tracked: e.target.checked }) }}
        />
      </div>
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
