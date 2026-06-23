interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  isLoading?: boolean;
}

export default function PaginationControls({
  currentPage,
  totalPages,
  hasNext,
  hasPrevious,
  onNext,
  onPrevious,
  isLoading = false,
}: PaginationControlsProps) {
  return (
    <nav
      className="flex items-center justify-center gap-2 mt-8 py-4"
      aria-label="Pagination navigation"
    >
      {/* Previous Button */}
      <button
        onClick={onPrevious}
        disabled={!hasPrevious || isLoading}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border
                   bg-card text-foreground hover:bg-muted transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Previous page"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        <span>Previous</span>
      </button>

      {/* Page Counter */}
      <span className="px-4 text-sm text-muted-foreground tabular-nums">
        {currentPage}
        <span className="text-muted-foreground/60"> / </span>
        {totalPages}
      </span>

      {/* Next Button */}
      <button
        onClick={onNext}
        disabled={!hasNext || isLoading}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border
                   bg-card text-foreground hover:bg-muted transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Next page"
      >
        <span>Next</span>
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>

      {/* Loading Spinner */}
      {isLoading && (
        <div className="ml-2" role="status" aria-live="polite">
          <div
            className="w-4 h-4 border-2 border-primary border-t-transparent
                       rounded-full animate-spin"
            aria-label="Loading"
          />
        </div>
      )}
    </nav>
  );
}
