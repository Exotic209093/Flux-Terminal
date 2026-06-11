// src/main/tailer.js
// Incremental byte-offset reader for actively-written JSONL files (extracted
// from live.js so every consumer shares one correct tail implementation).
//
// Contract per readDelta():
//   - reads only bytes appended since the previous call
//   - consumes up to the LAST newline; a partial trailing line is left for the
//     next call (the file is being written while we read)
//   - a shrink (truncation/rotation) returns { reset: true } with no objects
//     and restarts the offset at 0 — the caller rebuilds its accumulator and
//     calls readDelta() again to re-read from the start
//   - stat/read errors throw; the caller decides whether that means "starting",
//     "evict", or "retry next tick"
const fs = require('fs')
const { parseLine } = require('./parser')

function createTail(file, { fsImpl = fs } = {}) {
  let offset = 0
  return {
    get offset() {
      return offset
    },
    /** => { reset, objects, parseErrors, size, mtimeMs } */
    readDelta() {
      const stat = fsImpl.statSync(file)
      if (stat.size < offset) {
        offset = 0
        return { reset: true, objects: [], parseErrors: 0, size: stat.size, mtimeMs: stat.mtimeMs }
      }
      const objects = []
      let parseErrors = 0
      if (stat.size > offset) {
        const len = stat.size - offset
        const buf = Buffer.alloc(len)
        const fd = fsImpl.openSync(file, 'r')
        try {
          fsImpl.readSync(fd, buf, 0, len, offset)
        } finally {
          fsImpl.closeSync(fd)
        }
        const chunk = buf.toString('utf8')
        const lastNl = chunk.lastIndexOf('\n')
        if (lastNl !== -1) {
          const complete = chunk.slice(0, lastNl)
          offset += Buffer.byteLength(chunk.slice(0, lastNl + 1), 'utf8')
          for (const line of complete.split('\n')) {
            if (!line.trim()) continue
            const o = parseLine(line)
            if (o) objects.push(o)
            // invalid COMPLETE lines count as parse errors (the truncated final
            // line never reaches here — it's held back for the next call)
            else parseErrors++
          }
        }
      }
      return { reset: false, objects, parseErrors, size: stat.size, mtimeMs: stat.mtimeMs }
    }
  }
}

module.exports = { createTail }
