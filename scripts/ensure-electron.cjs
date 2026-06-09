// Repairs Electron's local binary when its bundled `extract-zip` fails.
//
// On this toolchain (Node 24 + Electron 42 on Windows), electron's own
// postinstall (install.js -> extract-zip) silently stalls after the first zip
// entry and exits 0, leaving node_modules/electron/dist without electron.exe.
// We re-fetch the (cached) artifact via @electron/get and extract it with a
// reliable extractor, then write path.txt exactly like electron's install.js.
//
// Runs as the project's postinstall, AFTER electron's own (failed) postinstall.

const fs = require('fs')
const path = require('path')
const cp = require('child_process')

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')

function platformExe() {
  if (process.platform === 'win32') return 'electron.exe'
  if (process.platform === 'darwin') return 'Electron.app/Contents/MacOS/Electron'
  return 'electron'
}

const exeRel = platformExe()
const distPath = path.join(electronDir, 'dist')
const exePath = path.join(distPath, exeRel)
const pathTxt = path.join(electronDir, 'path.txt')

function binaryPresent() {
  return fs.existsSync(exePath)
}

function extract(zip, dest) {
  if (process.platform === 'win32') {
    const esc = (s) => s.replace(/'/g, "''")
    const psCmd = `Expand-Archive -LiteralPath '${esc(zip)}' -DestinationPath '${esc(dest)}' -Force`
    cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
      stdio: 'inherit'
    })
  } else {
    cp.execFileSync('unzip', ['-o', zip, '-d', dest], { stdio: 'inherit' })
  }
}

async function main() {
  if (binaryPresent()) {
    console.log('[ensure-electron] binary present — nothing to do')
    return
  }
  if (!fs.existsSync(electronDir)) {
    console.log('[ensure-electron] electron package not installed — skipping')
    return
  }

  console.log('[ensure-electron] electron binary missing; repairing extract-zip stall…')
  const { downloadArtifact } = require('@electron/get')
  const version = require(path.join(electronDir, 'package.json')).version
  const checksums = require(path.join(electronDir, 'checksums.json'))

  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
    checksums
  })
  console.log('[ensure-electron] artifact:', zipPath)

  fs.rmSync(distPath, { recursive: true, force: true })
  fs.mkdirSync(distPath, { recursive: true })
  extract(zipPath, distPath)

  // Mirror electron/install.js: lift the type definitions out of dist.
  const srcDts = path.join(distPath, 'electron.d.ts')
  if (fs.existsSync(srcDts)) {
    fs.renameSync(srcDts, path.join(electronDir, 'electron.d.ts'))
  }
  fs.writeFileSync(pathTxt, exeRel)

  if (!binaryPresent()) {
    throw new Error('extraction finished but ' + exePath + ' is still missing')
  }
  console.log('[ensure-electron] repaired ->', exePath)
}

main().catch((err) => {
  console.error('[ensure-electron] FAILED:', err && err.message ? err.message : err)
  process.exit(1)
})
