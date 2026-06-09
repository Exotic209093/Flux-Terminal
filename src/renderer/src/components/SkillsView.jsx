import { useEffect, useState, useCallback } from 'react'

export default function SkillsView() {
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
        load() // refresh installed flags + user list
      })
      .finally(() => setInstalling(null))
  }

  if (error) return <div className="sv-empty error">⚠ {error}</div>
  if (!data) return <div className="sv-empty">Scanning skills…</div>

  const totals = data.user.length + data.plugin.length

  return (
    <div className="skills-view">
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
    </div>
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
