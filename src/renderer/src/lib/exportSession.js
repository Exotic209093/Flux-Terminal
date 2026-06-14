// Serialise a parsed session detail to Markdown.
function toMarkdown(detail) {
  if (!detail) return ''
  const out = ['# ' + (detail.title || 'Session')]
  if (detail.cwd) out.push('', '`' + detail.cwd + '`')
  out.push('')
  for (const it of detail.timeline || []) {
    switch (it.kind) {
      case 'user':
        out.push('### You', '', (it.text || '').trim(), '')
        break
      case 'text':
        out.push('### Claude', '', (it.text || '').trim(), '')
        break
      case 'thinking':
        out.push('> 💭 ' + (it.text || '').trim().replace(/\n/g, '\n> '), '')
        break
      case 'tool_use':
        out.push('**🔧 ' + (it.toolName || 'tool') + '**', '')
        break
      case 'tool_result':
        out.push('```', (it.text || '').slice(0, 2000), '```', '')
        break
      case 'hook':
        out.push('_hook: ' + (it.hookName || '') + '_', '')
        break
      default:
        break
    }
  }
  return out.join('\n')
}

export { toMarkdown }
