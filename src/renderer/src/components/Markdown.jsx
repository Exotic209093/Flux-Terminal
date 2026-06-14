import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

// Safe markdown rendering for transcript text. react-markdown never uses
// innerHTML; links open through the main process's window-open-deny policy, so
// rendering them as anchors is inert. Syntax highlighting via highlight.js.
export default function Markdown({ text }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text || ''}
      </ReactMarkdown>
    </div>
  )
}
