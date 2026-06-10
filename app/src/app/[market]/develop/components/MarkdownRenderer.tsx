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
  variant?: 'chat' | 'docs'
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
  fullscreen = false,
  variant = 'chat'
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

  const wrapperClass = variant === 'docs'
    ? `docs-prose ${className}`.trim()
    : `markdown-content ${className}`.trim()

  return (
    <div className={wrapperClass}>
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
            if (variant === 'docs') return <h1>{children}</h1>
            return <h1 className={`font-bold mt-2 mb-1 text-gray-900 ${fullscreen ? 'text-2xl' : 'text-xl'}`}>{children}</h1>
          },
          h2({ children }) {
            if (variant === 'docs') return <h2>{children}</h2>
            return <h2 className={`font-semibold mt-1.5 mb-1 text-gray-900 ${fullscreen ? 'text-xl' : 'text-lg'}`}>{children}</h2>
          },
          h3({ children }) {
            if (variant === 'docs') return <h3>{children}</h3>
            return <h3 className={`font-semibold mt-1 mb-0.5 text-gray-900 ${fullscreen ? 'text-lg' : 'text-base'}`}>{children}</h3>
          },
          p({ children }) {
            if (variant === 'docs') return <p>{children}</p>
            return <p className={`mb-1 leading-relaxed ${fullscreen ? 'text-base' : ''}`}>{children}</p>
          },
          ul({ children }) {
            if (variant === 'docs') return <ul>{children}</ul>
            return <ul className="list-disc pl-2 mb-1 space-y-0.5">{children}</ul>
          },
          ol({ children }) {
            if (variant === 'docs') return <ol>{children}</ol>
            return <ol className="list-decimal pl-2 mb-1 space-y-0.5">{children}</ol>
          },
          li({ children }) {
            if (variant === 'docs') return <li>{children}</li>
            return <li className="text-sm">{children}</li>
          },
          blockquote({ children }) {
            if (variant === 'docs') return <blockquote>{children}</blockquote>
            return <blockquote className="border-l-4 border-gray-300 pl-2 italic text-gray-700 my-1">{children}</blockquote>
          },
          table({ children }) {
            if (variant === 'docs') return <table>{children}</table>
            return <table className="border-collapse border border-gray-300 w-full my-1">{children}</table>
          },
          th({ children }) {
            if (variant === 'docs') return <th>{children}</th>
            return <th className="border border-gray-300 px-1 py-0.5 bg-gray-100 font-semibold text-left">{children}</th>
          },
          td({ children }) {
            if (variant === 'docs') return <td>{children}</td>
            return <td className="border border-gray-300 px-1 py-0.5">{children}</td>
          },
          a({ href, children }) {
            if (variant === 'docs') return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
            return <a href={href} className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer">{children}</a>
          },
          strong({ children }) {
            if (variant === 'docs') return <strong>{children}</strong>
            return <strong className="font-semibold">{children}</strong>
          },
          em({ children }) {
            if (variant === 'docs') return <em>{children}</em>
            return <em className="italic">{children}</em>
          }
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
