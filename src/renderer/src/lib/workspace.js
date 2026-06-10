// src/renderer/src/lib/workspace.js
// PURE tab/pane state. Callers generate ids (crypto.randomUUID) and pass them in
// action payloads so transitions are deterministic + unit-testable. Two panes
// max per tab (split-once). State:
//   { tabs: [ { id, title, splitDir: null|'h'|'v', ratio, activePaneId,
//               panes: [ { id, ptyId, profileId } ] } ],
//     activeTabId }

function tab({ tabId, paneId, ptyId, profileId, title }) {
  return {
    id: tabId,
    title: title || 'shell',
    splitDir: null,
    ratio: 0.5,
    activePaneId: paneId,
    panes: [{ id: paneId, ptyId, profileId }]
  }
}

function initialState(seed) {
  return { tabs: [tab(seed)], activeTabId: seed.tabId }
}

function mapTab(state, tabId, fn) {
  return { ...state, tabs: state.tabs.map((t) => (t.id === tabId ? fn(t) : t)) }
}

function findTabOfPane(state, paneId) {
  return state.tabs.find((t) => t.panes.some((p) => p.id === paneId)) || null
}

function reducer(state, action) {
  switch (action.type) {
    case 'NEW_TAB':
      return { ...state, tabs: [...state.tabs, tab(action)], activeTabId: action.tabId }

    case 'CLOSE_TAB': {
      const idx = state.tabs.findIndex((t) => t.id === action.tabId)
      if (idx === -1) return state
      const tabs = state.tabs.filter((t) => t.id !== action.tabId)
      let activeTabId = state.activeTabId
      if (state.activeTabId === action.tabId) {
        const neighbor = tabs[idx - 1] || tabs[idx] || tabs[0]
        activeTabId = neighbor ? neighbor.id : null
      }
      return { ...state, tabs, activeTabId }
    }

    case 'SPLIT':
      return mapTab(state, action.tabId, (t) => {
        if (t.panes.length >= 2) return t // max 2
        return {
          ...t,
          splitDir: action.dir,
          activePaneId: action.paneId,
          panes: [...t.panes, { id: action.paneId, ptyId: action.ptyId, profileId: action.profileId }]
        }
      })

    case 'CLOSE_PANE': {
      const owner = findTabOfPane(state, action.paneId)
      if (!owner) return state
      if (owner.panes.length === 1) return reducer(state, { type: 'CLOSE_TAB', tabId: owner.id })
      const panes = owner.panes.filter((p) => p.id !== action.paneId)
      return mapTab(state, owner.id, (t) => ({
        ...t,
        panes,
        splitDir: null,
        activePaneId: panes[0].id
      }))
    }

    case 'FOCUS_PANE': {
      const owner = findTabOfPane(state, action.paneId)
      if (!owner) return state
      return mapTab({ ...state, activeTabId: owner.id }, owner.id, (t) => ({
        ...t,
        activePaneId: action.paneId
      }))
    }

    case 'FOCUS_TAB':
      return state.tabs.some((t) => t.id === action.tabId) ? { ...state, activeTabId: action.tabId } : state

    case 'NEXT_TAB': {
      if (state.tabs.length < 2) return state
      const i = state.tabs.findIndex((t) => t.id === state.activeTabId)
      const next = state.tabs[(i + 1) % state.tabs.length]
      return { ...state, activeTabId: next.id }
    }

    case 'SET_RATIO':
      return mapTab(state, action.tabId, (t) => ({ ...t, ratio: action.ratio }))

    case 'RENAME_TAB':
      return mapTab(state, action.tabId, (t) => ({ ...t, title: action.title }))

    default:
      return state
  }
}

function allPtyIds(state) {
  return state.tabs.flatMap((t) => t.panes.map((p) => p.ptyId))
}

function deriveTitle({ title, profileName, cwd } = {}) {
  if (title) return title
  if (profileName) return profileName
  if (cwd) {
    const parts = String(cwd).split(/[\\/]/).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return 'shell'
}

export { reducer, initialState, allPtyIds, deriveTitle }
