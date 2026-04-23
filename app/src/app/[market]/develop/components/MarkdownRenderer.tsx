'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import CodeBlockFallback from '@/app/[market]/develop/components/CodeBlockFallback'

// SyntaxHighlighter + Prism is ~150KB gz; lazy-load since most messages have no code blocks
const CodeBlock = dynamic(() => import('@/app/[market]/develop/components/CodeBlock'), {
  loading: () => <CodeBlockFallback />,
})

interface MarkdownRendererProps {
  content: string
  className?: string
  fullscreen?: boolean
}

// Utility function to check and handle incomplete markdown markers
const processMarkdown = (content: string): string => {
  let processedContent = content

  // Handle incomplete code blocks
  const codeBlockMatches = content.match(/```[\s\S]*?(?:```|$)/g) || []
  const lastCodeBlock = codeBlockMatches[codeBlockMatches.length - 1]
  if (lastCodeBlock && !lastCodeBlock.endsWith('```')) {
    // If the last code block is incomplete, temporarily close it for rendering
    processedContent = content + '\n```'
  }

  // Handle incomplete bold markers (**text without closing **)
  const boldMatches = content.match(/\*\*/g) || []
  if (boldMatches.length % 2 !== 0) {
    // Odd number of ** means incomplete bold
    processedContent = processedContent + '**'
  }

  // Handle incomplete italic markers (*text without closing *)
  // We need to be careful not to count ** as * markers
  const contentWithoutBold = content.replace(/\*\*/g, '')
  const italicMatches = contentWithoutBold.match(/\*/g) || []
  if (italicMatches.length % 2 !== 0) {
    // Odd number of * means incomplete italic
    processedContent = processedContent + '*'
  }

  // Handle incomplete strikethrough markers (~~text without closing ~~)
  const strikethroughMatches = content.match(/~~/g) || []
  if (strikethroughMatches.length % 2 !== 0) {
    processedContent = processedContent + '~~'
  }

  // Handle incomplete inline code markers (`text without closing `)
  const inlineCodeMatches = content.match(/`/g) || []
  if (inlineCodeMatches.length % 2 !== 0) {
    processedContent = processedContent + '`'
  }

  return processedContent
}

export default function MarkdownRenderer({
  content,
  className = '',
  fullscreen = false
}: MarkdownRendererProps) {
  const [displayContent, setDisplayContent] = useState(content)

  // Update display content immediately for streaming
  useEffect(() => {
    setDisplayContent(content)
  }, [content])

  // Process the content to handle incomplete markers
  const processedContent = useMemo(() => {
    return processMarkdown(displayContent)
  }, [displayContent])

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{

          code(props: any) {
            const { inline, className, children } = props
            const match = /language-(\w+)/.exec(className || '')
            return !inline && match ? (
              <CodeBlock language={match[1]}>
                {String(children).replace(/\n$/, '')}
              </CodeBlock>
            ) : (
              <code className="bg-intents-ux-boxLowContrast-backgroundColor text-xs px-0.5 py-0.5 font-mono" {...props}>
                {children}
              </code>
            )
          },
          pre({ children }) {
            return <div className="my-1">{children}</div>
          },
          h1({ children }) {
            return <h1 className={`font-bold mt-2 mb-1 text-gray-900 ${fullscreen ? 'text-2xl' : 'text-xl'}`}>{children}</h1>
          },
          h2({ children }) {
            return <h2 className={`font-semibold mt-1.5 mb-1 text-gray-900 ${fullscreen ? 'text-xl' : 'text-lg'}`}>{children}</h2>
          },
          h3({ children }) {
            return <h3 className={`font-semibold mt-1 mb-0.5 text-gray-900 ${fullscreen ? 'text-lg' : 'text-base'}`}>{children}</h3>
          },
          p({ children }) {
            return <p className={`mb-1 leading-relaxed ${fullscreen ? 'text-base' : ''}`}>{children}</p>
          },
          ul({ children }) {
            return <ul className="list-disc pl-2 mb-1 space-y-0.5">{children}</ul>
          },
          ol({ children }) {
            return <ol className="list-decimal pl-2 mb-1 space-y-0.5">{children}</ol>
          },
          li({ children }) {
            return <li className="text-sm">{children}</li>
          },
          blockquote({ children }) {
            return <blockquote className="border-l-4 border-gray-300 pl-2 italic text-gray-700 my-1">{children}</blockquote>
          },
          table({ children }) {
            return <table className="border-collapse border border-gray-300 w-full my-1">{children}</table>
          },
          th({ children }) {
            return <th className="border border-gray-300 px-1 py-0.5 bg-gray-100 font-semibold text-left">{children}</th>
          },
          td({ children }) {
            return <td className="border border-gray-300 px-1 py-0.5">{children}</td>
          },
          a({ href, children }) {
            return <a href={href} className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer">{children}</a>
          },
          strong({ children }) {
            return <strong className="font-semibold">{children}</strong>
          },
          em({ children }) {
            return <em className="italic">{children}</em>
          }
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
