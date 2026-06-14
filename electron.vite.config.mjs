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
          ptymanager: resolve('src/main/ptymanager.js'),
          sessions: resolve('src/main/sessions.js'),
          parser: resolve('src/main/parser.js'),
          live: resolve('src/main/live.js'),
          skills: resolve('src/main/skills.js'),
          usage: resolve('src/main/usage.js'),
          commands: resolve('src/main/commands.js'),
          subagents: resolve('src/main/subagents.js'),
          search: resolve('src/main/search.js'),
          prompts: resolve('src/main/prompts.js'),
          settings: resolve('src/main/settings.js'),
          attention: resolve('src/main/attention.js'),
          monitor: resolve('src/main/monitor.js'),
          notify: resolve('src/main/notify.js'),
          missioncontrol: resolve('src/main/missioncontrol.js'),
          appprotocol: resolve('src/main/appprotocol.js'),
          resume: resolve('src/main/resume.js'),
          tailer: resolve('src/main/tailer.js'),
          sessionindex: resolve('src/main/sessionindex.js'),
          searchindex: resolve('src/main/searchindex.js'),
          environment: resolve('src/main/environment.js'),
          crashlog: resolve('src/main/crashlog.js'),
          updater: resolve('src/main/updater.js'),
          deeplink: resolve('src/main/deeplink.js'),
          tray: resolve('src/main/tray.js'),
          shellio: resolve('src/main/shellio.js')
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
