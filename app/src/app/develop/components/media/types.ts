/**
 * Media slot types for the media management system
 */

/**
 * A media slot represents a single image/video placement in an app
 */
export interface MediaSlot {
  /** Type of media in this slot */
  mediaType: 'image' | 'video' | 'generated';
  /** Current URL being used */
  currentUrl: string;
  /** Search query used to find this media */
  searchQuery: string;
  /** Requested size constraints */
  requestedSize?: {
    width: number;
    height: number;
    fit: 'cover' | 'contain' | 'crop';
  };
  /** Image orientations filter (e.g., "horizontal", "vertical", "square") */
  orientations?: string;
  /** Image compositions filter (e.g., "close-up", "wide-angle", "overhead") */
  compositions?: string;
  /** Alternative URLs that can be swapped in */
  alternatives: string[];
  /** Whether the user has modified this slot */
  userModified: boolean;
  /** When the slot was created */
  createdAt: string;
  /** When the slot was last updated */
  lastUpdated: string;
}

/**
 * Response from GET /media/:appId/slots/:slotName
 */
export interface GetSlotResponse {
  success: boolean;
  slot?: MediaSlot;
  error?: string;
}

/**
 * Response from PUT /media/:appId/slots/:slotName
 */
export interface UpdateSlotResponse {
  success: boolean;
  slot?: MediaSlot;
  commitHash?: string;
  error?: string;
}
