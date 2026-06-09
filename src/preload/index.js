const { contextBridge, ipcRenderer } = require('electron')

// Safe, minimal bridge exposed to the renderer as `window.flux`.
contextBridge.exposeInMainWorld('flux', {
  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
    write: (data) => ipcRenderer.send('pty:write', data),
    resize: (size) => ipcRenderer.send('pty:resize', size),
    onData: (cb) => {
      const listener = (_e, data) => cb(data)
      ipcRenderer.on('pty:data', listener)
      return () => ipcRenderer.removeListener('pty:data', listener)
    },
    onExit: (cb) => {
      const listener = (_e, code) => cb(code)
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
  }
})
