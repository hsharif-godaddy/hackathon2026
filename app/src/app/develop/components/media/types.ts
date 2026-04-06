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
  /** For videos: thumbnail image URL for preview display */
  thumbnailUrl?: string;
  /** Search query used to find this media */
  searchQuery: string;
  /** Requested size constraints */
  requestedSize?: {
    width: number;
    height: number;
    fit: 'cover' | 'contain' | 'crop';
  };
  // Search filters used to find this media (comma-separated strings)
  orientations?: string;
  compositions?: string;
  moods?: string;
  graphicalStyles?: string;
  sortOrder?: string;
  color?: string;
  numberOfPeople?: string;
  ethnicity?: string;
  ageOfPeople?: string;
  minimumSize?: string;
  /** Alternative URLs that can be swapped in */
  alternatives: string[];
  /** Whether the user has modified this slot */
  userModified: boolean;
  /** When the slot was created */
  createdAt: string;
  /** When the slot was last updated */
  lastUpdated: string;
  /** Getty image ID for the current image */
  gettyId?: string;
  /** Getty image IDs for alternative images (parallel to alternatives array) */
  alternativeGettyIds?: string[];
  /** Maps upload URLs to original chat upload filenames for dedup display */
  uploadSources?: Record<string, string>;
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
