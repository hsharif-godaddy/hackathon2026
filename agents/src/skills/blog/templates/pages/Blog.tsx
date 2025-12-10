import { useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import BlogHero from '../components/blog/BlogHero';
import BlogGrid from '../components/blog/BlogGrid';
import { getBlogPosts, getPostsByCategory, getPostsByTag, paginatePosts, getAllCategories, getAllTags } from '../lib/blog';
import type { BlogPost } from '../lib/blog';

/**
 * Blog page component
 *
 * Displays a list of blog posts with filtering and pagination.
 * Supports filtering by category and tag via URL search params.
 */
export default function BlogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);

  // Get filter params
  const categoryFilter = searchParams.get('category');
  const tagFilter = searchParams.get('tag');
  const page = parseInt(searchParams.get('page') || '1', 10);

  useEffect(() => {
    // Load posts based on filters
    let filteredPosts: BlogPost[];

    if (categoryFilter) {
      filteredPosts = getPostsByCategory(categoryFilter);
    } else if (tagFilter) {
      filteredPosts = getPostsByTag(tagFilter);
    } else {
      filteredPosts = getBlogPosts();
    }

    setPosts(filteredPosts);
    setCategories(getAllCategories());
    setTags(getAllTags());
  }, [categoryFilter, tagFilter]);

  // Paginate posts
  const { posts: paginatedPosts, pagination } = paginatePosts(posts, page, 9);

  // Clear filters
  const clearFilters = () => {
    setSearchParams({});
  };

  // Set category filter
  const setCategory = (category: string) => {
    setSearchParams({ category });
  };

  // Set tag filter
  const setTag = (tag: string) => {
    setSearchParams({ tag });
  };

  // Change page
  const goToPage = (newPage: number) => {
    const params: Record<string, string> = { page: newPage.toString() };
    if (categoryFilter) params.category = categoryFilter;
    if (tagFilter) params.tag = tagFilter;
    setSearchParams(params);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section - Customize title/subtitle to match your site's brand and purpose */}
      <BlogHero
        title="Blog"
        subtitle="Thoughts, stories, and ideas"
        variant="default"
      />

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* Filters */}
        <div className="mb-8 flex flex-wrap items-center gap-4">
          {/* Active Filters */}
          {(categoryFilter || tagFilter) && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Filters:</span>
              {categoryFilter && (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-full text-sm font-medium">
                  Category: {categoryFilter}
                  <button
                    onClick={clearFilters}
                    className="hover:opacity-80 transition-opacity"
                    aria-label="Clear filter"
                  >
                    ×
                  </button>
                </span>
              )}
              {tagFilter && (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-full text-sm font-medium">
                  Tag: {tagFilter}
                  <button
                    onClick={clearFilters}
                    className="hover:opacity-80 transition-opacity"
                    aria-label="Clear filter"
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
          )}

          {/* Category Filter Dropdown */}
          {categories.length > 0 && !categoryFilter && (
            <div className="relative">
              <select
                className="px-4 py-2 bg-card border border-border rounded-lg text-foreground text-sm font-medium hover:border-primary transition-colors cursor-pointer"
                onChange={(e) => setCategory(e.target.value)}
                value=""
              >
                <option value="">Filter by category</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Tag Filter */}
          {tags.length > 0 && !tagFilter && (
            <div className="flex flex-wrap gap-2">
              <span className="text-sm text-muted-foreground self-center">Tags:</span>
              {tags.slice(0, 5).map((tag) => (
                <button
                  key={tag}
                  onClick={() => setTag(tag)}
                  className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded-full hover:bg-accent/80 transition-colors"
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Post Count */}
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">
            {pagination.totalPosts} {pagination.totalPosts === 1 ? 'post' : 'posts'}
            {categoryFilter && ` in ${categoryFilter}`}
            {tagFilter && ` tagged with ${tagFilter}`}
          </p>
        </div>

        {/* Blog Grid */}
        <BlogGrid posts={paginatedPosts} variant="default" columns={3} />

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="mt-12 flex justify-center items-center gap-2">
            <button
              onClick={() => goToPage(pagination.currentPage - 1)}
              disabled={!pagination.hasPreviousPage}
              className="px-4 py-2 bg-card border border-border rounded-lg text-foreground font-medium hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            <div className="flex gap-2">
              {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((pageNum) => (
                <button
                  key={pageNum}
                  onClick={() => goToPage(pageNum)}
                  className={`w-10 h-10 rounded-lg font-medium transition-colors ${
                    pageNum === pagination.currentPage
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border border-border text-foreground hover:border-primary'
                  }`}
                >
                  {pageNum}
                </button>
              ))}
            </div>

            <button
              onClick={() => goToPage(pagination.currentPage + 1)}
              disabled={!pagination.hasNextPage}
              className="px-4 py-2 bg-card border border-border rounded-lg text-foreground font-medium hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
