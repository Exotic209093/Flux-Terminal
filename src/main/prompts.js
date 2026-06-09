const fs = require('fs')
const os = require('os')
const path = require('path')
const { randomUUID } = require('crypto')

// Persistent prompt library stored in userData/prompts.json.
// Schema: { version: 1, prompts: [{id, name, body, createdAt, updatedAt, uses}] }
//
// Writes are atomic: write to a .tmp sibling then rename over the target.
// Corrupt files are backed up to <file>.corrupt and replaced with a fresh store.

const STARTER_PROMPTS = [
  {
    name: 'Explain this',
    body: 'Explain the following code concisely, focusing on what it does and any non-obvious behaviour:\n\n{{code}}'
  },
  {
    name: 'Review for bugs',
    body: 'Review this code for bugs, edge-cases, and correctness issues. Be specific about line numbers where possible.\n\n{{code}}\n\n{{cursor}}'
  },
  {
    name: 'Write a commit message',
    body: 'Write a concise, imperative-mood git commit message for the following diff. Output just the message, no explanation.\n\n{{diff}}'
  }
]

class PromptStore {
  constructor(filePath) {
    this._file = filePath || path.join(os.homedir(), '.config', 'flux-terminal', 'prompts.json')
    this._data = null // lazy-loaded
  }

  // ---- private ------------------------------------------------------------

  _load() {
    if (this._data) return
    try {
      const raw = fs.readFileSync(this._file, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version === 1 && Array.isArray(parsed.prompts)) {
        this._data = parsed
        return
      }
      throw new Error('unexpected schema')
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Fresh store — no backup needed
        this._data = { version: 1, prompts: [] }
        return
      }
      // Corrupt or unreadable — back it up and start fresh
      try {
        fs.copyFileSync(this._file, this._file + '.corrupt')
      } catch {
        /* backup best-effort */
      }
      this._data = { version: 1, prompts: [] }
    }
  }

  _save() {
    const dir = path.dirname(this._file)
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      /* already exists */
    }
    const tmp = this._file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this._data, null, 2), 'utf-8')
    fs.renameSync(tmp, this._file)
  }

  // ---- public API ---------------------------------------------------------

  list() {
    this._load()
    // Sort by most-used first; ties keep insertion order (stable sort in V8)
    return [...this._data.prompts].sort((a, b) => (b.uses || 0) - (a.uses || 0))
  }

  /**
   * Create or update a prompt.
   * If `data.id` matches an existing prompt it is updated (preserving uses +
   * createdAt). Otherwise a new prompt is created.
   * Returns the saved prompt object.
   */
  save(data) {
    this._load()
    const now = new Date().toISOString()
    const existing = data.id ? this._data.prompts.find((p) => p.id === data.id) : null
    if (existing) {
      existing.name = data.name
      existing.body = data.body
      existing.updatedAt = now
      this._save()
      return { ...existing }
    }
    const prompt = {
      id: randomUUID(),
      name: data.name,
      body: data.body,
      createdAt: now,
      updatedAt: now,
      uses: 0
    }
    this._data.prompts.push(prompt)
    this._save()
    return { ...prompt }
  }

  /** Remove a prompt by id. No-op for unknown ids. */
  delete(id) {
    this._load()
    const before = this._data.prompts.length
    this._data.prompts = this._data.prompts.filter((p) => p.id !== id)
    if (this._data.prompts.length !== before) this._save()
  }

  /** Increment the uses counter for a prompt. No-op for unknown ids. */
  used(id) {
    this._load()
    const p = this._data.prompts.find((p) => p.id === id)
    if (!p) return
    p.uses = (p.uses || 0) + 1
    p.updatedAt = new Date().toISOString()
    this._save()
  }

  /**
   * Seed starter prompts if the store is currently empty.
   * Idempotent: does nothing when any prompt already exists.
   */
  seed() {
    this._load()
    if (this._data.prompts.length > 0) return
    const now = new Date().toISOString()
    for (const tmpl of STARTER_PROMPTS) {
      this._data.prompts.push({
        id: randomUUID(),
        name: tmpl.name,
        body: tmpl.body,
        createdAt: now,
        updatedAt: now,
        uses: 0
      })
    }
    this._save()
  }
}

module.exports = { PromptStore, STARTER_PROMPTS }
