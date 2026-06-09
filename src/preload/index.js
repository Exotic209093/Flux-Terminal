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
    read: (file) => ipcRenderer.invoke('session:read', file)
  }
})
