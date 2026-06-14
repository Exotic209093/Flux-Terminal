// Pure aggregation of file edits from a parsed timeline. The diff data lives on
// tool_result items as item.result.structuredPatch (from the parser goldmine).

function diffStats(patch) {
  if (!Array.isArray(patch)) return { adds: 0, dels: 0 }
  let adds = 0
  let dels = 0
  for (const hunk of patch) {
    for (const line of (hunk && hunk.lines) || []) {
      if (line[0] === '+') adds++
      else if (line[0] === '-') dels++
    }
  }
  return { adds, dels }
}

function collectFilesTouched(timeline) {
  const byFile = new Map()
  for (const item of timeline || []) {
    if (!item || item.kind !== 'tool_result' || !item.result || !item.result.filePath) continue
    const fp = item.result.filePath
    const patch = item.result.structuredPatch
    const stats = diffStats(patch)
    if (!byFile.has(fp)) byFile.set(fp, { filePath: fp, edits: [], adds: 0, dels: 0 })
    const entry = byFile.get(fp)
    entry.edits.push({ ts: item.ts || null, patch: patch || null, stats })
    entry.adds += stats.adds
    entry.dels += stats.dels
  }
  return [...byFile.values()]
}

export { diffStats, collectFilesTouched }
