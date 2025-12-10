import { useParams, Link, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import BlogPost from '../components/blog/BlogPost';
import BlogGrid from '../components/blog/BlogGrid';
import { getPostBySlug, getRelatedPosts } from '../lib/blog';
import type { BlogPost as BlogPostType } from '../lib/blog';

/**
 * Blog post detail page component
 *
 * Displays a single blog post with related posts.
 * Uses the slug parameter from the URL to find the post.
 */
export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPostType | null>(null);
  const [relatedPosts, setRelatedPosts] = useState<BlogPostType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      return;
    }

    const foundPost = getPostBySlug(slug);
    setPost(foundPost);

    if (foundPost) {
      setRelatedPosts(getRelatedPosts(foundPost, 3));
    }

    setLoading(false);
  }, [slug]);

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading post...</p>
        </div>
      </div>
    );
  }

  // Post not found - redirect to blog
  if (!post) {
    return <Navigate to="/blog" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Back to Blog Link */}
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <Link
          to="/blog"
          className="inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-colors font-medium"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Blog
        </Link>
      </div>

      {/* Blog Post Content */}
      <BlogPost post={post} />

      {/* Related Posts */}
      {relatedPosts.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 py-16 border-t border-border mt-16">
          <h2 className="text-3xl font-bold text-foreground mb-8">
            Related Posts
          </h2>
          <BlogGrid posts={relatedPosts} variant="default" columns={3} />
        </div>
      )}
    </div>
  );
}
