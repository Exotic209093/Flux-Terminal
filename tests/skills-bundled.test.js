// tests/skills-bundled.test.js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { bundledSkillsDir } = require('../src/main/skills')

test('dev: bundled skills resolve under appPath/skills when it exists', () => {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-skills-'))
  fs.mkdirSync(path.join(appPath, 'skills'))
  assert.strictEqual(bundledSkillsDir(appPath), path.join(appPath, 'skills'))
})

test('packaged: falls back to process.resourcesPath/skills when appPath/skills is missing', () => {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-asar-')) // simulates the asar root: no skills/
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-res-'))
  fs.mkdirSync(path.join(resources, 'skills'))
  const orig = process.resourcesPath
  process.resourcesPath = resources
  try {
    assert.strictEqual(bundledSkillsDir(appPath), path.join(resources, 'skills'))
  } finally {
    process.resourcesPath = orig
  }
})
