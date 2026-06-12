import { useState, useEffect } from 'react';
import type { IDXListing } from '../lib/idx-broker/types';
import PropertyCard from '../components/PropertyCard';

export default function FeaturedListings() {
  const [listings, setListings] = useState<IDXListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchListings() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/idx-broker/featured');

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error || `Failed to fetch listings (${response.status})`
          );
        }

        const data = await response.json();
        setListings(data.listings || []);
      } catch (err) {
        console.error('Error fetching IDX Broker listings:', err);
        setError(
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred'
        );
      } finally {
        setLoading(false);
      }
    }

    fetchListings();
  }, []);

  return (
    <div className="container mx-auto px-4 py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-foreground">
          Featured Properties
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Explore our hand-picked selection of featured real estate listings
        </p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-muted-foreground">Loading properties...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <div className="flex items-start gap-3">
            <svg
              className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <h3 className="font-semibold text-red-900">
                Error Loading Properties
              </h3>
              <p className="mt-1 text-sm text-red-700">{error}</p>
              {error.includes('Invalid') && (
                <p className="mt-2 text-sm text-red-700">
                  Please check your IDX Broker API key in the secrets settings.
                </p>
              )}
              {error.includes('not configured') && (
                <p className="mt-2 text-sm text-red-700">
                  Configure your IDX Broker API key to display listings.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && listings.length === 0 && (
        <div className="text-center py-16">
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
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          <h3 className="text-xl font-semibold text-foreground">
            No Featured Properties
          </h3>
          <p className="mt-2 text-muted-foreground">
            There are no featured properties available at this time.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check back soon for new listings.
          </p>
        </div>
      )}

      {/* Listings Grid */}
      {!loading && !error && listings.length > 0 && (
        <>
          <p className="mb-6 text-muted-foreground">
            Showing {listings.length} {listings.length === 1 ? 'property' : 'properties'}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {listings.map((listing) => (
              <PropertyCard key={listing.listingID} listing={listing} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
