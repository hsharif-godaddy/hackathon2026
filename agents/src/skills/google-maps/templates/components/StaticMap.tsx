/**
 * StaticMap Component
 * Simple Google Maps iframe embed.
 * FREE - no API key required.
 */

interface StaticMapProps {
  /** Address or place name to display */
  location: string;
  /** Height of the map container */
  height?: number | string;
  /** Zoom level (1-20) */
  zoom?: number;
  /** Additional CSS classes */
  className?: string;
}

export default function StaticMap({
  location,
  height = 450,
  zoom = 15,
  className = '',
}: StaticMapProps) {
  const encodedLocation = encodeURIComponent(location);
  const mapSrc = `https://www.google.com/maps?q=${encodedLocation}&z=${zoom}&output=embed`;

  return (
    <div
      className={`rounded-2xl overflow-hidden border-4 border-border ${className}`}
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
    >
      <iframe
        src={mapSrc}
        width="100%"
        height="100%"
        style={{ border: 0 }}
        allowFullScreen
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title={location}
      />
    </div>
  );
}
