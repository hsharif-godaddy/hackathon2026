import { Link } from 'react-router-dom';
import type { BlogPost } from '../../lib/blog';
import { formatPostDate, calculateReadingTime } from '../../lib/blog';

/**
 * BlogCard Component Props
 */
interface BlogCardProps {
  /** Blog post data to display */
  post: BlogPost;
  /** Card layout variant */
  variant?: 'default' | 'horizontal' | 'minimal';
}

/**
 * BlogCard Component
 *
 * Displays a blog post preview card with image, title, excerpt, and metadata.
 * Automatically inherits site colors from CSS variables.
 *
 * @param props - Component props
 * @returns BlogCard component
 */
export default function BlogCard({ post, variant = 'default' }: BlogCardProps) {
  const readingTime = calculateReadingTime(post.content);
  const formattedDate = formatPostDate(post.publishedAt, 'short');

  if (variant === 'horizontal') {
    return (
      <Link
        to={`/blog/${post.slug}`}
        className="group flex flex-col sm:flex-row gap-6 bg-card rounded-2xl border-2 border-border overflow-hidden hover:shadow-2xl hover:border-primary/30 transition-all duration-300"
      >
        {post.featuredImage && (
          <div className="sm:w-72 h-56 sm:h-auto flex-shrink-0 overflow-hidden">
            <img
              src={post.featuredImage}
              alt={post.title}
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
            />
          </div>
        )}
        <div className="flex-1 p-8">
          {post.category && (
            <span className="inline-block px-3 py-1 text-xs font-bold tracking-wide uppercase text-primary bg-primary/10 rounded-full border border-primary/20 mb-3">
              {post.category}
            </span>
          )}
          <h3 className="text-2xl md:text-3xl font-bold text-foreground mt-2 group-hover:text-primary transition-colors leading-tight">
            {post.title}
          </h3>
          <p className="text-muted-foreground mt-4 line-clamp-2 text-base leading-relaxed">{post.excerpt}</p>
          <div className="flex items-center gap-3 mt-6 text-sm text-muted-foreground font-medium">
            <time dateTime={post.publishedAt}>{formattedDate}</time>
            <span className="text-border">•</span>
            <span>{readingTime} min read</span>
            {post.author && (
              <>
                <span className="text-border">•</span>
                <span className="text-foreground">{post.author}</span>
              </>
            )}
          </div>
        </div>
      </Link>
    );
  }

  if (variant === 'minimal') {
    return (
      <Link
        to={`/blog/${post.slug}`}
        className="group block py-6 border-b-2 border-border/50 hover:border-primary/50 transition-all"
      >
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            {post.category && (
              <span className="text-xs font-bold uppercase tracking-wide text-primary">{post.category}</span>
            )}
            <h3 className="text-xl font-bold text-foreground mt-2 group-hover:text-primary transition-colors leading-snug">
              {post.title}
            </h3>
            <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground font-medium">
              <time dateTime={post.publishedAt}>{formattedDate}</time>
              <span className="text-border">•</span>
              <span>{readingTime} min read</span>
            </div>
          </div>
          {post.featuredImage && (
            <div className="w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden ring-2 ring-border group-hover:ring-primary/30 transition-all">
              <img
                src={post.featuredImage}
                alt={post.title}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
              />
            </div>
          )}
        </div>
      </Link>
    );
  }

  // Default variant
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="group block bg-card rounded-2xl border-2 border-border overflow-hidden hover:shadow-2xl hover:border-primary/30 hover:-translate-y-1 transition-all duration-300"
    >
      {post.featuredImage && (
        <div className="aspect-[16/9] overflow-hidden">
          <img
            src={post.featuredImage}
            alt={post.title}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
          />
        </div>
      )}
      <div className="p-6 lg:p-8">
        {post.category && (
          <span className="inline-block px-3 py-1 text-xs font-bold tracking-wide uppercase text-primary bg-primary/10 rounded-full border border-primary/20">
            {post.category}
          </span>
        )}
        <h3 className="text-xl md:text-2xl font-bold text-foreground mt-4 group-hover:text-primary transition-colors leading-tight">
          {post.title}
        </h3>
        <p className="text-muted-foreground mt-3 line-clamp-3 leading-relaxed">{post.excerpt}</p>
        <div className="flex items-center gap-3 mt-6 text-sm text-muted-foreground font-medium">
          <time dateTime={post.publishedAt}>{formattedDate}</time>
          <span className="text-border">•</span>
          <span>{readingTime} min read</span>
          {post.author && (
            <>
              <span className="text-border">•</span>
              <span className="text-foreground">{post.author}</span>
            </>
          )}
        </div>
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-5">
            {post.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-3 py-1.5 text-xs font-semibold bg-accent/50 text-foreground rounded-lg border border-border/50"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
