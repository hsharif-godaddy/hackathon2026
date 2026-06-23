/**
 * IDX Broker API Type Definitions
 *
 * Note: IDX Broker returns all numeric fields as strings, not numbers.
 * Prices are pre-formatted with dollar signs and commas.
 */

export interface IDXListingImage {
  url: string;
  caption: string;
}

export interface IDXListingImages {
  [key: string]: IDXListingImage | string; // numeric keys for images, 'totalCount' for count
  totalCount: string;
}

export interface IDXListing {
  listingID: string;
  address: string;
  streetName: string;
  streetNumber: string;
  streetDirection?: string;
  unitNumber?: string;
  cityName: string;
  countyName: string;
  state: string;
  zipcode: string;
  listingPrice: string;          // Formatted string: "$1,151,000"
  bedrooms: string;              // String, not number
  totalBaths: string;            // String: "2.75"
  sqFt: string;                  // String: "2,760"
  acres: string;
  remarksConcat: string;         // Property description
  propStatus: string;            // "Active", "Pending", etc.
  latitude: string;
  longitude: string;
  featured: string;              // "y" or "n"
  rntLse?: string;               // "rent", "lease", "neither"
  image: IDXListingImages;
  detailsURL: string;            // Relative URL
  fullDetailsURL: string;        // Absolute URL
  idxID: string;
  idxPropType: string;           // "Residential", etc.
  idxStatus: string;             // "active", etc.
  viewCount?: string;
  mediaData?: unknown[];
  listingAgentID?: string;
  listingOfficeID?: string;
  ohCount?: string;              // Open house count
  vtCount?: string;              // Virtual tour count
  displayAddress?: string;       // "y" or "n"
}

/**
 * Data object from IDX Broker /clients/featured endpoint
 * Object with encoded keys, NOT an array
 */
export interface IDXFeaturedData {
  [key: string]: IDXListing;     // Object with encoded keys like "a000!%M1422715"
}

/**
 * Full response from IDX Broker /clients/featured endpoint
 * Includes pagination metadata and data object
 */
export interface IDXFeaturedResponse {
  total: number;
  first: string;                 // URL to first page
  last: string;                  // URL to last page
  next: string | null;           // URL to next page, null if on last page
  previous: string | null;       // URL to previous page, null if on first page
  data: IDXFeaturedData;
}

/**
 * Helper function to convert IDX Broker response to array
 *
 * @param response - Raw response from IDX Broker API
 * @returns Array of listings for easy iteration
 *
 * @example
 * const apiResponse = await response.json();
 * const listings = parseIDXListings(apiResponse);
 * listings.forEach(listing => console.log(listing.address));
 */
export function parseIDXListings(response: IDXFeaturedResponse): IDXListing[] {
  return Object.values(response.data).filter((item) => item !== null);
}

/**
 * Get the primary (first) image URL from a listing
 *
 * @param listing - IDX listing object
 * @returns Image URL or null if no images
 *
 * @example
 * const imageUrl = getPrimaryImage(listing);
 * if (imageUrl) {
 *   return <img src={imageUrl} alt={listing.address} />;
 * }
 */
export function getPrimaryImage(listing: IDXListing): string | null {
  const firstImage = listing.image?.['0'];
  return typeof firstImage === 'object' ? firstImage.url : null;
}

/**
 * Get all image URLs from a listing
 *
 * @param listing - IDX listing object
 * @returns Array of image URLs
 *
 * @example
 * const images = getAllImages(listing);
 * console.log(`Property has ${images.length} images`);
 */
export function getAllImages(listing: IDXListing): string[] {
  if (!listing.image) return [];

  const images: string[] = [];
  const keys = Object.keys(listing.image).filter(key => key !== 'totalCount');

  for (const key of keys) {
    const img = listing.image[key];
    if (typeof img === 'object' && 'url' in img) {
      images.push(img.url);
    }
  }

  return images;
}

/**
 * Parse formatted price string to number
 *
 * @param price - Formatted price string like "$1,151,000"
 * @returns Numeric price value
 *
 * @example
 * const price = parsePriceToNumber("$1,151,000");
 * console.log(price); // 1151000
 */
export function parsePriceToNumber(price: string): number {
  return parseFloat(price.replace(/[$,]/g, ''));
}

/**
 * Check if listing is currently active
 *
 * @param listing - IDX listing object
 * @returns true if listing is active and available
 *
 * @example
 * if (isActiveListing(listing)) {
 *   console.log('Property is available');
 * }
 */
export function isActiveListing(listing: IDXListing): boolean {
  return (
    listing.propStatus.toLowerCase() === 'active' &&
    listing.idxStatus.toLowerCase() === 'active'
  );
}

/**
 * Pagination metadata from IDX Broker API
 * Used for navigating through featured listing pages
 */
export interface IDXPaginationMetadata {
  total: number;              // Total number of listings
  first: string;              // URL to first page
  last: string;               // URL to last page
  next: string | null;        // URL to next page, null if on last page
  previous: string | null;    // URL to previous page, null if on first page
}

/**
 * Response from /api/idx-broker/featured endpoint with pagination
 */
export interface IDXPaginatedResponse {
  listings: IDXListing[];
  pagination: IDXPaginationMetadata;
}
