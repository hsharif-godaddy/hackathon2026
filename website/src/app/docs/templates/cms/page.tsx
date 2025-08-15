import Link from 'next/link'
import {
  SparklesIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  CubeTransparentIcon,
  ArrowLeftIcon,
  PlayIcon,
  CheckCircleIcon,
  ClockIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline'

export default function CMSTemplate() {
  const features = [
    {
      title: "Rich Text Editor",
      description: "WYSIWYG editor with markdown support, media embedding, and collaborative editing",
      icon: DocumentTextIcon,
      details: ["Real-time collaboration", "Markdown shortcuts", "Image/video embedding", "Version history"]
    },
    {
      title: "Media Management",
      description: "Complete asset management system with CDN integration and automatic optimization",
      icon: CubeTransparentIcon,
      details: ["Drag & drop uploads", "Automatic image optimization", "CDN delivery", "Asset organization"]
    },
    {
      title: "API-First Architecture",
      description: "Headless CMS with RESTful and GraphQL APIs for maximum flexibility",
      icon: CodeBracketIcon,
      details: ["REST & GraphQL APIs", "Webhook support", "Third-party integrations", "Custom endpoints"]
    },
    {
      title: "Role-Based Access",
      description: "Granular permissions system with custom roles and content approval workflows",
      icon: UserGroupIcon,
      details: ["Custom user roles", "Content approval", "Publishing workflows", "Audit trails"]
    }
  ]

  const techStack = [
    { name: "Next.js 14", purpose: "Full-stack framework with App Router" },
    { name: "TypeScript", purpose: "Type safety and developer experience" },
    { name: "Prisma ORM", purpose: "Database modeling and type-safe queries" },
    { name: "PostgreSQL", purpose: "Robust relational database" },
    { name: "shadcn/ui", purpose: "Beautiful, accessible UI components" },
    { name: "Tailwind CSS", purpose: "Utility-first styling" },
    { name: "NextAuth.js", purpose: "Authentication and session management" },
    { name: "Tiptap Editor", purpose: "Rich text editing experience" },
    { name: "Uploadthing", purpose: "File upload and media management" },
    { name: "Zod", purpose: "Schema validation" }
  ]

  const codeExamples = [
    {
      title: "Content Model Definition",
      language: "TypeScript",
      code: `// prisma/schema.prisma
model Post {
  id          String   @id @default(cuid())
  title       String
  slug        String   @unique
  content     Json     // Rich text content
  excerpt     String?
  featuredImage String?
  status      PostStatus @default(DRAFT)
  publishedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  author      User     @relation(fields: [authorId], references: [id])
  authorId    String
  category    Category @relation(fields: [categoryId], references: [id])
  categoryId  String
  tags        Tag[]
}

enum PostStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}`
    },
    {
      title: "Content API Endpoint",
      language: "TypeScript",
      code: `// app/api/posts/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')
  const status = searchParams.get('status') || 'PUBLISHED'

  const posts = await prisma.post.findMany({
    where: { status },
    include: {
      author: { select: { name: true, image: true } },
      category: true,
      tags: true
    },
    orderBy: { publishedAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit
  })

  return NextResponse.json({
    posts,
    pagination: {
      page,
      limit,
      total: await prisma.post.count({ where: { status } })
    }
  })
}`
    },
    {
      title: "Rich Text Component",
      language: "TypeScript",
      code: `// components/editor/rich-text-editor.tsx
'use client'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'

interface RichTextEditorProps {
  content: string
  onChange: (content: string) => void
  editable?: boolean
}

export function RichTextEditor({ 
  content, 
  onChange, 
  editable = true 
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        HTMLAttributes: {
          class: 'rounded-lg max-w-full h-auto',
        },
      }),
      Link.configure({
        openOnClick: false,
      }),
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  return (
    <div className="border rounded-lg">
      {editable && <EditorToolbar editor={editor} />}
      <EditorContent 
        editor={editor} 
        className="prose max-w-none p-4 focus:outline-none"
      />
    </div>
  )
}`
    }
  ]

  const setupSteps = [
    {
      step: 1,
      title: "Initialize Project",
      description: "Create a new Next.js project with TypeScript and install dependencies",
      commands: [
        "npx create-next-app@latest cms-app --typescript --tailwind --eslint --app",
        "cd cms-app",
        "pnpm add prisma @prisma/client next-auth @auth/prisma-adapter",
        "pnpm add @tiptap/react @tiptap/starter-kit @tiptap/extension-image"
      ]
    },
    {
      step: 2,
      title: "Configure Database",
      description: "Set up PostgreSQL database and Prisma schema",
      commands: [
        "npx prisma init",
        "# Edit prisma/schema.prisma with your models",
        "npx prisma generate",
        "npx prisma db push"
      ]
    },
    {
      step: 3,
      title: "Authentication Setup",
      description: "Configure NextAuth.js for user management",
      commands: [
        "# Create .env.local with AUTH_SECRET and DATABASE_URL",
        "# Configure NextAuth providers in app/api/auth/[...nextauth]/route.ts"
      ]
    },
    {
      step: 4,
      title: "Build CMS Interface",
      description: "Create admin dashboard and content management pages",
      commands: [
        "# Create admin layout and dashboard",
        "# Build content editor components",
        "# Set up API routes for content management"
      ]
    }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                <SparklesIcon className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                Airo
              </span>
            </Link>
            <nav className="hidden md:flex space-x-8">
              <Link href="/" className="text-gray-600 hover:text-gray-900 transition-colors">
                Home
              </Link>
              <Link href="/pricing" className="text-gray-600 hover:text-gray-900 transition-colors">
                Pricing
              </Link>
              <Link href="/team" className="text-gray-600 hover:text-gray-900 transition-colors">
                Meet the Agents
              </Link>
              <Link href="/docs" className="text-purple-600 font-medium">
                Documentation
              </Link>
            </nav>
            <div className="flex items-center space-x-4">
              <Link
                href="/builder"
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:shadow-lg transition-all duration-200 hover:scale-105"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center space-x-2 text-sm text-gray-600 mb-8">
          <Link href="/docs" className="hover:text-purple-600 transition-colors">Documentation</Link>
          <span>/</span>
          <span>Templates</span>
          <span>/</span>
          <span className="text-gray-900 font-medium">Content Management System</span>
        </div>

        {/* Hero Section */}
        <div className="mb-16">
          <div className="flex items-center mb-6">
            <Link
              href="/docs"
              className="inline-flex items-center text-purple-600 hover:text-purple-700 transition-colors mr-6"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-2" />
              Back to Documentation
            </Link>
            <div className="flex items-center space-x-3">
              <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full">
                Beginner Friendly
              </span>
              <span className="flex items-center text-sm text-gray-600">
                <ClockIcon className="w-4 h-4 mr-1" />
                2-3 hours setup
              </span>
            </div>
          </div>

          <div className="flex items-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-r from-purple-100 to-blue-100 rounded-xl flex items-center justify-center mr-6">
              <DocumentTextIcon className="w-8 h-8 text-purple-600" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">
                Content Management System
              </h1>
              <p className="text-xl text-gray-600">
                Headless CMS with admin interface, rich text editing, and API-first architecture
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600 mb-1">API-First</div>
                <div className="text-sm text-gray-600">RESTful & GraphQL APIs</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600 mb-1">Multi-User</div>
                <div className="text-sm text-gray-600">Role-based permissions</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 mb-1">Production Ready</div>
                <div className="text-sm text-gray-600">Optimized & scalable</div>
              </div>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">Key Features</h2>
          <div className="grid md:grid-cols-2 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center mb-4">
                  <div className="w-10 h-10 bg-gradient-to-r from-purple-100 to-blue-100 rounded-lg flex items-center justify-center mr-4">
                    <feature.icon className="w-6 h-6 text-purple-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">{feature.title}</h3>
                </div>
                <p className="text-gray-600 mb-4">{feature.description}</p>
                <div className="grid grid-cols-2 gap-2">
                  {feature.details.map((detail, detailIndex) => (
                    <div key={detailIndex} className="flex items-center text-sm text-gray-700">
                      <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2" />
                      {detail}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tech Stack Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">Technology Stack</h2>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="grid md:grid-cols-2 gap-0">
              {techStack.map((tech, index) => (
                <div key={index} className={`p-4 border-b border-gray-100 ${index % 2 === 1 ? 'md:border-l' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-gray-900">{tech.name}</div>
                    <div className="text-sm text-gray-600">{tech.purpose}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Code Examples Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">Code Examples</h2>
          <div className="space-y-8">
            {codeExamples.map((example, index) => (
              <div key={index} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">{example.title}</h3>
                    <span className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded-md">
                      {example.language}
                    </span>
                  </div>
                </div>
                <div className="p-6">
                  <pre className="text-sm overflow-x-auto">
                    <code className="language-typescript text-gray-800">
                      {example.code}
                    </code>
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Setup Guide Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">Quick Setup Guide</h2>
          <div className="space-y-6">
            {setupSteps.map((step, index) => (
              <div key={index} className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-start">
                  <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-full flex items-center justify-center font-semibold text-sm mr-4 mt-1">
                    {step.step}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
                    <p className="text-gray-600 mb-4">{step.description}</p>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <pre className="text-sm text-gray-800 overflow-x-auto">
                        {step.commands.map((command, cmdIndex) => (
                          <div key={cmdIndex} className={command.startsWith('#') ? 'text-gray-500 italic' : ''}>
                            {command}
                          </div>
                        ))}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA Section */}
        <section>
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-8 text-center text-white">
            <h2 className="text-3xl font-bold mb-4">Ready to Build Your CMS?</h2>
            <p className="text-lg mb-8 opacity-90 max-w-2xl mx-auto">
              Let our AI agents help you customize this template for your specific content needs.
              Get a production-ready CMS in hours, not weeks.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/builder"
                className="inline-flex items-center justify-center px-8 py-3 bg-white text-purple-600 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
              >
                <PlayIcon className="w-5 h-5 mr-2" />
                Start Building CMS
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center justify-center px-8 py-3 border-2 border-white text-white font-semibold rounded-lg hover:bg-white hover:text-purple-600 transition-colors"
              >
                View All Templates
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center text-gray-600">
            <p>&copy; 2024 Airo AI Builder. Built with AI for the future.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
