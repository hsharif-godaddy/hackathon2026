'use client'

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface CodeBlockProps {
  language: string
  children: string
  className?: string
}

export default function CodeBlock({ language, children, className = 'rounded-md' }: CodeBlockProps) {
  return (
    <SyntaxHighlighter
      style={oneDark}
      language={language}
      PreTag="div"
      className={className}
    >
      {children}
    </SyntaxHighlighter>
  )
}
