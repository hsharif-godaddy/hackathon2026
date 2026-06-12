import type { IDXListing } from '../lib/idx-broker/types';
import { getPrimaryImage } from '../lib/idx-broker/types';

interface PropertyCardProps {
  listing: IDXListing;
}

export default function PropertyCard({ listing }: PropertyCardProps) {
  const primaryImage = getPrimaryImage(listing);

  return (
    <article className="group rounded-xl border border-border bg-card shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
      {/* Property Image */}
      <div className="aspect-video overflow-hidden rounded-t-xl bg-muted">
        {primaryImage ? (
          <img
            src={primaryImage}
            alt={`${listing.address}, ${listing.cityName}, ${listing.state}`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <svg
              className="w-16 h-16"
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
          </div>
        )}
      </div>

      {/* Property Details */}
      <div className="p-4">
        {/* Price */}
        <p className="text-2xl font-bold text-primary">
          {listing.listingPrice}
        </p>

        {/* Address */}
        <p className="text-lg font-semibold mt-2 text-foreground">
          {listing.address}
        </p>
        <p className="text-sm text-muted-foreground">
          {listing.cityName}, {listing.state} {listing.zipcode}
        </p>

        {/* Property Stats */}
        <div className="flex flex-wrap gap-4 mt-4 text-sm text-muted-foreground">
          {listing.bedrooms && (
            <div className="flex items-center gap-1">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              <span>{listing.bedrooms} {parseInt(listing.bedrooms) === 1 ? 'bed' : 'beds'}</span>
            </div>
          )}

          {listing.totalBaths && (
            <div className="flex items-center gap-1">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                />
              </svg>
              <span>{listing.totalBaths} {parseFloat(listing.totalBaths) === 1 ? 'bath' : 'baths'}</span>
            </div>
          )}

          {listing.sqFt && (
            <div className="flex items-center gap-1">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
              <span>{listing.sqFt} sq ft</span>
            </div>
          )}
        </div>

        {/* Property Status */}
        {listing.propStatus && (
          <div className="mt-3">
            <span
              className={`inline-block px-2 py-1 text-xs font-semibold rounded ${
                listing.propStatus.toLowerCase() === 'active'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-yellow-100 text-yellow-800'
              }`}
            >
              {listing.propStatus}
            </span>
          </div>
        )}

        {/* View Details Link */}
        <a
          href={listing.fullDetailsURL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          View Full Details
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 8l4 4m0 0l-4 4m4-4H3"
            />
          </svg>
        </a>
      </div>
    </article>
  );
}
