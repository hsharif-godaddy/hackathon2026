import { useEffect, useState } from 'react';
import type { BlogPost as BlogPostType } from '../../lib/blog';
import { formatPostDate, calculateReadingTime } from '../../lib/blog';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * BlogPost Component Props
 */
interface BlogPostProps {
  /** Blog post data to display */
  post: BlogPostType;
}

/**
 * BlogPost Component
 *
 * Displays a full blog post with metadata, content, and navigation.
 * Features reading progress indicator, decorative elements, and stylish typography.
 * Automatically inherits site colors from CSS variables.
 *
 * @param props - Component props
 * @returns BlogPost component
 */
export default function BlogPost({ post }: BlogPostProps) {
  const readingTime = calculateReadingTime(post.content);
  const formattedDate = formatPostDate(post.publishedAt, 'full');
  const updatedDate = post.updatedAt ? formatPostDate(post.updatedAt, 'long') : null;

  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight - windowHeight;
      const scrolled = window.scrollY;
      const progress = (scrolled / documentHeight) * 100;
      setScrollProgress(Math.min(100, Math.max(0, progress)));
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      {/* Reading Progress Bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-border/30">
        <div
          className="h-full bg-gradient-to-r from-primary via-primary/80 to-primary transition-all duration-150 ease-out"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>

      <article className="relative">
        {/* Decorative background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute top-1/3 -left-40 w-80 h-80 bg-accent/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 -right-32 w-72 h-72 bg-primary/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
          {/* Header Section with Visual Flair */}
          <header className="mb-16 lg:mb-24">
            <div className="text-center">
              {post.category && (
                <div className="mb-8 animate-fade-in">
                  <span className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold tracking-widest uppercase text-primary bg-gradient-to-r from-primary/10 to-primary/5 rounded-full border-2 border-primary/20 shadow-lg shadow-primary/10">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    {post.category}
                  </span>
                </div>
              )}

              <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-foreground mb-10 leading-[0.95] tracking-tighter">
                <span className="bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-transparent">
                  {post.title}
                </span>
              </h1>

              {post.excerpt && (
                <p className="text-xl md:text-3xl text-muted-foreground mb-12 max-w-3xl mx-auto leading-relaxed font-light">
                  {post.excerpt}
                </p>
              )}

              {/* Enhanced Metadata Card */}
              <div className="inline-flex items-center gap-4 px-8 py-4 bg-accent/30 rounded-2xl border-2 border-border/50 shadow-xl backdrop-blur-sm">
                {post.author && (
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg">
                      <span className="text-lg font-bold text-white">
                        {post.author.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="font-bold text-foreground tracking-wide">{post.author}</span>
                  </div>
                )}
                <span className="text-border text-2xl">•</span>
                <time dateTime={post.publishedAt} className="tracking-wide text-muted-foreground font-medium">
                  {formattedDate}
                </time>
                <span className="text-border text-2xl">•</span>
                <span className="tracking-wide text-muted-foreground font-medium flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {readingTime} min read
                </span>
              </div>

              {updatedDate && (
                <div className="mt-6 text-sm text-muted-foreground/80 italic">
                  Last updated: {updatedDate}
                </div>
              )}
            </div>
          </header>

          {/* Featured Image with Frame */}
          {post.featuredImage && (
            <div className="mb-20 lg:mb-28 relative group">
              <div className="absolute -inset-4 bg-gradient-to-r from-primary/20 to-accent/20 rounded-3xl blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative rounded-3xl overflow-hidden shadow-2xl ring-1 ring-border/50">
                <img
                  src={post.featuredImage}
                  alt={post.title}
                  className="w-full h-auto object-cover transform group-hover:scale-[1.02] transition-transform duration-700"
                  loading="eager"
                />
              </div>
            </div>
          )}

          {/* Main Content with Drop Cap and Enhanced Styling */}
          <div className="relative">
            {/* Side decoration line */}
            <div className="hidden lg:block absolute -left-20 top-0 bottom-0 w-1 bg-gradient-to-b from-transparent via-primary/30 to-transparent" />

            <div className="blog-content prose-custom">
              <style dangerouslySetInnerHTML={{ __html: `
                .prose-custom > :first-child::first-letter {
                  float: left;
                  font-size: 5.5rem;
                  line-height: 0.85;
                  font-weight: 900;
                  margin-right: 0.5rem;
                  margin-top: 0.15rem;
                  color: var(--primary);
                }
              `}} />

              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Custom heading renderers with decorative elements
                  h2: ({node, ...props}) => (
                    <div className="relative mt-20 mb-8 group">
                      <div className="absolute -left-8 top-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full opacity-50 group-hover:opacity-100 transition-opacity" />
                      <h2 className="text-4xl md:text-5xl font-black text-foreground leading-tight tracking-tight" {...props} />
                      <div className="mt-4 h-1 w-20 bg-gradient-to-r from-primary to-transparent rounded-full" />
                    </div>
                  ),
                  h3: ({node, ...props}) => (
                    <div className="relative mt-16 mb-6">
                      <div className="absolute -left-6 top-1/2 -translate-y-1/2 w-2 h-2 bg-primary/70 rounded-full" />
                      <h3 className="text-3xl md:text-4xl font-bold text-foreground leading-tight" {...props} />
                    </div>
                  ),
                  h4: ({node, ...props}) => (
                    <h4 className="text-2xl md:text-3xl font-bold text-foreground mt-12 mb-4 leading-tight" {...props} />
                  ),
                  // Enhanced paragraphs
                  p: ({node, ...props}) => (
                    <p className="text-lg md:text-xl text-muted-foreground leading-[1.8] mb-8 tracking-wide" {...props} />
                  ),
                  // Beautiful blockquotes
                  blockquote: ({node, ...props}) => (
                    <div className="relative my-12 pl-10 pr-8 py-8 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent rounded-2xl border-l-4 border-primary shadow-xl">
                      <svg className="absolute top-6 left-4 w-6 h-6 text-primary/40" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
                      </svg>
                      <blockquote className="text-xl md:text-2xl font-medium text-foreground leading-relaxed italic pl-6" {...props} />
                    </div>
                  ),
                  // Styled lists
                  ul: ({node, ...props}) => (
                    <ul className="my-10 space-y-4 text-lg text-muted-foreground" {...props} />
                  ),
                  ol: ({node, ...props}) => (
                    <ol className="my-10 space-y-4 text-lg text-muted-foreground" {...props} />
                  ),
                  li: ({node, ...props}) => (
                    <li className="leading-relaxed ml-8 pl-4 relative before:content-[''] before:absolute before:left-0 before:top-[0.65em] before:w-2 before:h-2 before:bg-primary before:rounded-full" {...props} />
                  ),
                  // Enhanced code blocks
                  code: ({node, inline, ...props}) => {
                    if (inline) {
                      return (
                        <code className="px-2 py-1 text-base font-mono text-primary bg-accent/50 rounded-lg border border-border/50" {...props} />
                      );
                    }
                    return (
                      <code className="block" {...props} />
                    );
                  },
                  pre: ({node, ...props}) => (
                    <div className="relative my-10 group">
                      <div className="absolute -inset-2 bg-gradient-to-r from-primary/10 to-accent/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                      <pre className="relative bg-accent/80 text-foreground rounded-2xl p-8 border-2 border-border shadow-2xl overflow-x-auto backdrop-blur-sm" {...props} />
                    </div>
                  ),
                  // Beautiful images
                  img: ({node, ...props}) => (
                    <div className="relative my-16 group">
                      <div className="absolute -inset-4 bg-gradient-to-r from-primary/10 to-accent/10 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                      <img className="relative w-full rounded-2xl shadow-2xl ring-1 ring-border/50" {...props} />
                    </div>
                  ),
                  // Horizontal rules as decorative elements
                  hr: ({node, ...props}) => (
                    <div className="my-20 flex items-center justify-center">
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-0.5 bg-gradient-to-r from-transparent to-border rounded-full" />
                        <div className="w-3 h-3 bg-primary rounded-full" />
                        <div className="w-8 h-0.5 bg-border rounded-full" />
                        <div className="w-3 h-3 bg-primary/60 rounded-full" />
                        <div className="w-16 h-0.5 bg-gradient-to-l from-transparent to-border rounded-full" />
                      </div>
                    </div>
                  ),
                  // Enhanced tables
                  table: ({node, ...props}) => (
                    <div className="my-12 rounded-2xl overflow-hidden shadow-2xl border-2 border-border">
                      <table className="w-full" {...props} />
                    </div>
                  ),
                  thead: ({node, ...props}) => (
                    <thead className="bg-gradient-to-r from-accent to-accent/80" {...props} />
                  ),
                  th: ({node, ...props}) => (
                    <th className="px-6 py-4 text-left font-bold text-foreground border-b-2 border-border" {...props} />
                  ),
                  td: ({node, ...props}) => (
                    <td className="px-6 py-4 text-muted-foreground border-b border-border/50" {...props} />
                  ),
                  tr: ({node, ...props}) => (
                    <tr className="even:bg-accent/20 hover:bg-accent/30 transition-colors" {...props} />
                  ),
                }}
              >
                {post.content}
              </ReactMarkdown>
            </div>
          </div>

          {/* Tags Section with Visual Interest */}
          {post.tags && post.tags.length > 0 && (
            <div className="mt-24 pt-12 border-t-2 border-border/50 relative">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-6 py-2 bg-background">
                <div className="flex gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <div className="w-2 h-2 rounded-full bg-primary/60" />
                  <div className="w-2 h-2 rounded-full bg-primary/30" />
                </div>
              </div>

              <div className="text-center mb-8">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">
                  Explore Topics
                </h3>
              </div>

              <div className="flex flex-wrap justify-center gap-4">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="group relative px-6 py-3 text-sm font-bold bg-gradient-to-br from-accent/50 to-accent/30 text-foreground rounded-xl border-2 border-border/50 hover:border-primary hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden"
                  >
                    <span className="absolute inset-0 bg-gradient-to-br from-primary/0 to-primary/0 group-hover:from-primary/10 group-hover:to-primary/5 transition-all duration-200" />
                    <span className="relative">#{tag}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Author Bio with Visual Flair */}
          {post.author && (
            <div className="mt-24 pt-12 border-t-2 border-border/50 relative">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-6 py-2 bg-background">
                <div className="w-8 h-1 bg-gradient-to-r from-transparent via-primary to-transparent rounded-full" />
              </div>

              <div className="relative p-10 bg-gradient-to-br from-accent/40 via-accent/20 to-transparent rounded-3xl border-2 border-border/50 shadow-2xl overflow-hidden">
                {/* Decorative corner elements */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full" />
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-accent/10 rounded-tr-full" />

                <div className="relative flex items-start gap-8">
                  <div className="flex-shrink-0 relative group">
                    <div className="absolute -inset-2 bg-gradient-to-br from-primary to-primary/50 rounded-full blur opacity-50 group-hover:opacity-75 transition-opacity" />
                    <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-xl ring-4 ring-background">
                      <span className="text-4xl font-black text-white">
                        {post.author.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground mb-3">
                      Written by
                    </p>
                    <h3 className="text-3xl font-black text-foreground mb-3">
                      {post.author}
                    </h3>
                    <p className="text-lg text-muted-foreground leading-relaxed">
                      Content creator and writer sharing insights and stories.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </article>
    </>
  );
}
