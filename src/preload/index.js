const { contextBridge, ipcRenderer } = require('electron')

// Safe, minimal bridge exposed to the renderer as `window.flux`.
contextBridge.exposeInMainWorld('flux', {
  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts), // opts: { id, cols, rows, cwd, shell }
    write: (id, data) => ipcRenderer.send('pty:write', { id, data }),
    resize: (id, size) => ipcRenderer.send('pty:resize', { id, cols: size.cols, rows: size.rows }),
    kill: (id) => ipcRenderer.send('pty:kill', { id }),
    onData: (cb) => {
      const listener = (_e, payload) => cb(payload) // { id, data }
      ipcRenderer.on('pty:data', listener)
      return () => ipcRenderer.removeListener('pty:data', listener)
    },
    onExit: (cb) => {
      const listener = (_e, payload) => cb(payload) // { id, code }
      ipcRenderer.on('pty:exit', listener)
      return () => ipcRenderer.removeListener('pty:exit', listener)
    }
  },
  sessions: {
    list: (opts) => ipcRenderer.invoke('sessions:list', opts),
    read: (file) => ipcRenderer.invoke('session:read', file),
    send: (args) => ipcRenderer.invoke('session:send', args),
    newChat: (args) => ipcRenderer.invoke('session:new', args),
    interrupt: () => ipcRenderer.invoke('session:interrupt'),
    watch: (file) => ipcRenderer.send('session:watch', file),
    unwatch: () => ipcRenderer.send('session:unwatch'),
    onRefresh: (cb) => {
      const listener = (_e, payload) => cb(payload)
      ipcRenderer.on('session:refresh', listener)
      return () => ipcRenderer.removeListener('session:refresh', listener)
    },
    onSendStatus: (cb) => {
      const listener = (_e, payload) => cb(payload)
      ipcRenderer.on('session:sendstatus', listener)
      return () => ipcRenderer.removeListener('session:sendstatus', listener)
    },
    onChanged: (cb) => {
      const listener = (_e, payload) => cb(payload) // { sessions }
      ipcRenderer.on('sessions:changed', listener)
      return () => ipcRenderer.removeListener('sessions:changed', listener)
    },
    onAppend: (cb) => {
      const listener = (_e, payload) => cb(payload) // { file, session, items }
      ipcRenderer.on('session:append', listener)
      return () => ipcRenderer.removeListener('session:append', listener)
    }
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    install: (name) => ipcRenderer.invoke('skills:install', name)
  },
  live: {
    track: (sessionId) => ipcRenderer.send('live:track', sessionId),
    stop: () => ipcRenderer.send('live:stop'),
    onUpdate: (cb) => {
      const listener = (_e, snap) => cb(snap)
      ipcRenderer.on('live:update', listener)
      return () => ipcRenderer.removeListener('live:update', listener)
    }
  },
  usage: {
    get: () => ipcRenderer.invoke('usage:get'),
    refresh: () => ipcRenderer.invoke('usage:refresh'),
    onUpdate: (cb) => {
      const listener = (_e, snap) => cb(snap)
      ipcRenderer.on('usage:update', listener)
      return () => ipcRenderer.removeListener('usage:update', listener)
    }
  },
  commands: {
    list: (cwd) => ipcRenderer.invoke('commands:list', cwd)
  },
  subagents: {
    list: (args) => ipcRenderer.invoke('subagents:list', args),
    read: (args) => ipcRenderer.invoke('subagent:read', args)
  },
  image: {
    stash: (args) => ipcRenderer.invoke('image:stash', args)
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke('dialog:pickFolder')
  },
  search: {
    query: (query) => ipcRenderer.invoke('search:query', { query }),
    onProgress: (cb) => {
      const listener = (_e, p) => cb(p)
      ipcRenderer.on('search:progress', listener)
      return () => ipcRenderer.removeListener('search:progress', listener)
    }
  },
  prompts: {
    list: () => ipcRenderer.invoke('prompts:list'),
    save: (data) => ipcRenderer.invoke('prompts:save', data),
    delete: (id) => ipcRenderer.invoke('prompts:delete', id),
    used: (id) => ipcRenderer.invoke('prompts:used', id)
  },
  settings: {
    initial: ipcRenderer.sendSync('settings:getSync'),
    get: () => ipcRenderer.invoke('settings:get'),
    set: (path, value) => ipcRenderer.invoke('settings:set', { path, value }),
    setNotify: (key, value) => ipcRenderer.invoke('settings:setNotify', { key, value }),
    profiles: () => ipcRenderer.invoke('settings:profiles'),
    saveProfile: (p) => ipcRenderer.invoke('settings:saveProfile', p),
    deleteProfile: (id) => ipcRenderer.invoke('settings:deleteProfile', id),
    getWorkspace: () => ipcRenderer.invoke('settings:getWorkspace'),
    setWorkspace: (layout) => ipcRenderer.send('settings:setWorkspace', layout)
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    reportError: (payload) => ipcRenderer.send('app:rendererError', payload)
  },
  env: {
    doctor: () => ipcRenderer.invoke('env:doctor')
  },
  notify: {
    setOpenSession: (sessionId) => ipcRenderer.send('notify:setOpenSession', sessionId),
    onOpenSession: (cb) => {
      const listener = (_e, payload) => cb(payload)
      ipcRenderer.on('notify:open-session', listener)
      return () => ipcRenderer.removeListener('notify:open-session', listener)
    },
    test: () => ipcRenderer.invoke('notify:test'),
    history: () => ipcRenderer.invoke('notify:history'),
    onHistoryAdd: (cb) => {
      const listener = (_e, entry) => cb(entry)
      ipcRenderer.on('notify:history-add', listener)
      return () => ipcRenderer.removeListener('notify:history-add', listener)
    },
    snooze: (sessionId, minutes) => ipcRenderer.invoke('notify:snooze', { sessionId, minutes })
  },
  missioncontrol: {
    list: () => ipcRenderer.invoke('missioncontrol:list'),
    onUpdate: (cb) => {
      const listener = (_e, cards) => cb(cards)
      ipcRenderer.on('missioncontrol:update', listener)
      return () => ipcRenderer.removeListener('missioncontrol:update', listener)
    }
  },
  deeplink: {
    onOpen: (cb) => {
      const listener = (_e, route) => cb(route)
      ipcRenderer.on('deeplink:open', listener)
      return () => ipcRenderer.removeListener('deeplink:open', listener)
    }
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p)
  },
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText')
  },
  file: {
    saveText: (args) => ipcRenderer.invoke('file:saveText', args)
  }
})
