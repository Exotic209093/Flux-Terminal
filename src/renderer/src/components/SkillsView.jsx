import { useEffect, useState, useCallback } from 'react'

export default function SkillsView() {
  return (
    <div className="skills-view">
      <SkillsPanel />
      <PromptLibraryPanel />
    </div>
  )
}

// ---- Skills panel (unchanged logic, extracted) ----------------------------

function SkillsPanel() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [installing, setInstalling] = useState(null)

  const load = useCallback(() => {
    window.flux.skills
      .list()
      .then((res) => {
        if (res.ok) setData(res.skills)
        else setError(res.error || 'failed to load skills')
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const install = (name) => {
    setInstalling(name)
    window.flux.skills
      .install(name)
      .then((res) => {
        if (!res.ok) setError(res.error || 'install failed')
        load()
      })
      .finally(() => setInstalling(null))
  }

  if (error) return <div className="sv-empty error">⚠ {error}</div>
  if (!data) return <div className="sv-empty">Scanning skills…</div>

  const totals = data.user.length + data.plugin.length

  return (
    <>
      <h2 className="stats-title">Skills</h2>
      <p className="skills-intro">
        {totals} skills available locally · {data.bundled.length} bundled with Flux you can install
      </p>

      {data.bundled.length > 0 && (
        <Section title="Bundled with Flux" subtitle="starter skills you can install into ~/.claude/skills">
          {data.bundled.map((s) => (
            <SkillCard
              key={'b-' + s.name}
              skill={s}
              action={
                s.installed ? (
                  <span className="skill-installed">✓ installed</span>
                ) : (
                  <button
                    className="skill-install"
                    onClick={() => install(s.name)}
                    disabled={installing === s.name}
                  >
                    {installing === s.name ? 'installing…' : 'Install'}
                  </button>
                )
              }
            />
          ))}
        </Section>
      )}

      <Section title="Your skills" subtitle="~/.claude/skills">
        {data.user.length === 0 && <div className="hint">No personal skills yet.</div>}
        {data.user.map((s) => (
          <SkillCard key={'u-' + s.name} skill={s} />
        ))}
      </Section>

      {data.plugin.length > 0 && (
        <Section title="Plugin skills" subtitle="from installed plugins">
          {data.plugin.map((s, i) => (
            <SkillCard key={'p-' + s.name + i} skill={s} badge={s.plugin} />
          ))}
        </Section>
      )}
    </>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <section className="skills-section">
      <div className="skills-section-head">
        <h3>{title}</h3>
        {subtitle && <span className="skills-section-sub">{subtitle}</span>}
      </div>
      <div className="skills-grid">{children}</div>
    </section>
  )
}

function SkillCard({ skill, action, badge }) {
  return (
    <div className="skill-card">
      <div className="skill-card-top">
        <span className="skill-name">🧩 {skill.name}</span>
        {badge && <span className="skill-badge">{badge}</span>}
        {action}
      </div>
      <div className="skill-desc">{skill.description || 'No description.'}</div>
    </div>
  )
}

// ---- Prompt library panel -------------------------------------------------

const EMPTY_FORM = { name: '', body: '' }

function PromptLibraryPanel() {
  const [prompts, setPrompts] = useState(null)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // null | { mode: 'add' } | { mode: 'edit', prompt }
  const [form, setForm] = useState(EMPTY_FORM)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // prompt id pending confirm
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    window.flux.prompts
      .list()
      .then((res) => {
        if (res.ok) setPrompts(res.prompts)
        else setError(res.error || 'failed to load prompts')
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openAdd = () => {
    setForm(EMPTY_FORM)
    setModal({ mode: 'add' })
  }

  const openEdit = (p) => {
    setForm({ name: p.name, body: p.body })
    setModal({ mode: 'edit', prompt: p })
  }

  const closeModal = () => {
    setModal(null)
    setForm(EMPTY_FORM)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.body.trim()) return
    setSaving(true)
    const data =
      modal.mode === 'edit'
        ? { id: modal.prompt.id, name: form.name.trim(), body: form.body.trim() }
        : { name: form.name.trim(), body: form.body.trim() }
    const res = await window.flux.prompts.save(data)
    setSaving(false)
    if (res.ok) {
      load()
      closeModal()
    } else {
      setError(res.error || 'save failed')
    }
  }

  const handleDelete = async (id) => {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id)
      return
    }
    setDeleteConfirm(null)
    const res = await window.flux.prompts.delete(id)
    if (res.ok) load()
    else setError(res.error || 'delete failed')
  }

  return (
    <section className="skills-section prompt-library-section">
      <div className="skills-section-head">
        <h3>Prompt Library</h3>
        <span className="skills-section-sub">type ;; in the composer to insert</span>
        <button className="skill-install prompt-add-btn" onClick={openAdd}>
          + Add
        </button>
      </div>

      {error && <div className="hint error">⚠ {error}</div>}

      {!prompts ? (
        <div className="hint">Loading…</div>
      ) : prompts.length === 0 ? (
        <div className="hint">No saved prompts yet.</div>
      ) : (
        <div className="prompt-list">
          {prompts.map((p) => (
            <div key={p.id} className="prompt-card">
              <div className="prompt-card-top">
                <span className="prompt-name">{p.name}</span>
                {p.uses > 0 && <span className="prompt-uses-badge">{p.uses} uses</span>}
                <button className="prompt-action" onClick={() => openEdit(p)}>
                  Edit
                </button>
                <button
                  className={'prompt-action prompt-delete' + (deleteConfirm === p.id ? ' confirm' : '')}
                  onClick={() => handleDelete(p.id)}
                >
                  {deleteConfirm === p.id ? 'Confirm?' : 'Delete'}
                </button>
              </div>
              <div className="prompt-body-preview">{p.body}</div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="prompt-modal-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="prompt-modal">
            <h3>{modal.mode === 'add' ? 'Add prompt' : 'Edit prompt'}</h3>
            <label className="prompt-label">
              Name
              <input
                className="prompt-input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Explain this"
                autoFocus
              />
            </label>
            <label className="prompt-label">
              Body
              <textarea
                className="prompt-textarea"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder={'Use {{variable}} for placeholders, {{cursor}} for insertion point'}
                rows={8}
              />
            </label>
            <div className="prompt-modal-actions">
              <button className="prompt-modal-cancel" onClick={closeModal}>
                Cancel
              </button>
              <button
                className="skill-install"
                onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.body.trim()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
