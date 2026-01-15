/**
 * DynamicMap Component
 * Interactive Google Map with markers and info windows.
 * Requires API key stored in secrets.
 */

import { APIProvider, Map, Marker, InfoWindow } from '@vis.gl/react-google-maps';
import { useEffect, useState, useCallback, useMemo } from 'react';

interface MapMarker {
  id?: string;
  lat: number;
  lng: number;
  label?: string;
  description?: string;
}

interface DynamicMapProps {
  /** Map center coordinates */
  center: { lat: number; lng: number };
  /** Zoom level (1-20) */
  zoom?: number;
  /** Markers to display (if empty, shows marker at center) */
  markers?: MapMarker[];
  /** Label for the center marker (when no markers provided) */
  centerLabel?: string;
  /** Height of the map container */
  height?: number | string;
  /** Additional CSS classes */
  className?: string;
}

export default function DynamicMap({
  center,
  zoom = 15,
  markers = [],
  centerLabel = 'Location',
  height = 450,
  className = '',
}: DynamicMapProps) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null);

  // If no markers provided, create one at center
  const allMarkers = useMemo(() => {
    if (markers.length > 0) return markers;
    return [{ lat: center.lat, lng: center.lng, label: centerLabel }];
  }, [markers, center, centerLabel]);

  useEffect(function fetchApiKey() {
    fetch('/api/maps/config')
      .then((res) => {
        if (!res.ok) throw new Error('API key not configured. Add GOOGLE_MAPS_API_KEY in Settings → Secrets.');
        return res.json();
      })
      .then((data) => {
        if (data.apiKey) {
          setApiKey(data.apiKey);
        } else {
          setError('API key not found. Add GOOGLE_MAPS_API_KEY in Settings → Secrets.');
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleMarkerClick = useCallback((marker: MapMarker) => {
    setSelectedMarker(marker);
  }, []);

  const containerStyle = {
    height: typeof height === 'number' ? `${height}px` : height,
  };

  if (error) {
    return (
      <div
        className={`rounded-2xl border-4 border-border bg-muted flex flex-col items-center justify-center gap-3 p-6 ${className}`}
        style={containerStyle}
      >
        <p className="font-medium text-foreground">Map Error</p>
        <p className="text-sm text-muted-foreground text-center">{error}</p>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Make sure Maps JavaScript API is enabled and billing is set up in Google Cloud Console.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={`rounded-2xl border-4 border-border bg-muted flex items-center justify-center ${className}`}
        style={containerStyle}
      >
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border-4 border-border overflow-hidden ${className}`}
      style={containerStyle}
    >
      <APIProvider apiKey={apiKey!}>
        <Map
          defaultCenter={center}
          defaultZoom={zoom}
          style={{ width: '100%', height: '100%' }}
          gestureHandling="greedy"
          disableDefaultUI={false}
        >
          {allMarkers.map((marker, index) => (
            <Marker
              key={marker.id || `marker-${index}`}
              position={{ lat: marker.lat, lng: marker.lng }}
              title={marker.label}
              onClick={() => handleMarkerClick(marker)}
            />
          ))}

          {selectedMarker && (
            <InfoWindow
              position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
              onCloseClick={() => setSelectedMarker(null)}
            >
              <div className="p-1">
                {selectedMarker.label && <p className="font-semibold">{selectedMarker.label}</p>}
                {selectedMarker.description && <p className="text-sm text-muted-foreground mt-1">{selectedMarker.description}</p>}
              </div>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
