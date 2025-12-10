import type { BlogPost } from '../../lib/blog';
import BlogCard from './BlogCard';

/**
 * BlogGrid Component Props
 */
interface BlogGridProps {
  /** Array of blog posts to display */
  posts: BlogPost[];
  /** Grid layout variant */
  variant?: 'default' | 'horizontal' | 'minimal';
  /** Number of columns (responsive) */
  columns?: 2 | 3 | 4;
}

/**
 * BlogGrid Component
 *
 * Displays a responsive grid of blog post cards.
 *
 * @param props - Component props
 * @returns BlogGrid component
 */
export default function BlogGrid({ posts, variant = 'default', columns = 3 }: BlogGridProps) {
  if (posts.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="max-w-md mx-auto">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="text-xl font-semibold text-foreground mb-2">No posts yet</h3>
          <p className="text-muted-foreground">
            This blog is ready to go! Posts will appear here once they're created.
          </p>
        </div>
      </div>
    );
  }

  // Handle horizontal variant - stack cards vertically
  if (variant === 'horizontal') {
    return (
      <div className="space-y-6">
        {posts.map((post) => (
          <BlogCard key={post.slug} post={post} variant="horizontal" />
        ))}
      </div>
    );
  }

  // Handle minimal variant - list format
  if (variant === 'minimal') {
    return (
      <div className="space-y-0">
        {posts.map((post) => (
          <BlogCard key={post.slug} post={post} variant="minimal" />
        ))}
      </div>
    );
  }

  // Default grid variant
  const gridColumns = {
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
  }[columns];

  return (
    <div className={`grid ${gridColumns} gap-8`}>
      {posts.map((post) => (
        <BlogCard key={post.slug} post={post} variant="default" />
      ))}
    </div>
  );
}
