import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Native modules (node-pty) and other runtime deps are kept external so they
// load from node_modules at runtime instead of being bundled by Vite.
//
// The main process is CommonJS and splits across index/pty/sessions/parser.
// Declaring each as a build input emits them as sibling files in out/main/, so
// the relative `require('./pty')` etc. resolve at runtime. (With a single entry,
// electron-vite left those requires unbundled and the files unemitted — the app
// failed to boot with "Cannot find module './pty'".)
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.js'),
          pty: resolve('src/main/pty.js'),
          sessions: resolve('src/main/sessions.js'),
          parser: resolve('src/main/parser.js'),
          live: resolve('src/main/live.js'),
          skills: resolve('src/main/skills.js')
        },
        output: {
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
