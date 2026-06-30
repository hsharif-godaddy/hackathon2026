/**
 * The structured draft payload stored in simple_campaign_content.raw_content for a
 * social asset, pre-launch. This is the single source of truth for the editable post
 * before it is materialized into a social_posts row at launch (RUBICON-441). Keep this
 * shape stable — 441 reads it to build the platform-bound post.
 */
export interface SocialRawContent {
  message: string;
  hashtags: string[];
  callToAction?: string;
  platform?: 'facebook' | 'instagram' | 'google_business_profile';
}

/** Serialize a payload to the JSON string stored in raw_content (drops undefined fields). */
export function serializeSocialRawContent(payload: SocialRawContent): string {
  const out: Record<string, unknown> = { message: payload.message, hashtags: payload.hashtags ?? [] };
  if (payload.callToAction !== undefined) {
    out.callToAction = payload.callToAction;
  }
  if (payload.platform !== undefined) {
    out.platform = payload.platform;
  }
  return JSON.stringify(out);
}

/** The fields a draft-edit may change. Omitted fields are left untouched. */
export interface SocialRawContentEdits {
  message?: string;
  hashtags?: string[];
  callToAction?: string;
}

/**
 * Apply a partial draft-edit over the existing raw_content, returning the next payload.
 * Omitted edit fields keep their current value; an explicit callToAction overwrites, an
 * omitted one is preserved, and platform is always carried through. When raw_content is
 * absent or malformed, message falls back to fallbackMessage (e.g. the content_preview
 * snapshot). This is the single merge used by both the agent tool and the HTTP route.
 */
export function mergeSocialRawContent(
  raw: string | null | undefined,
  edits: SocialRawContentEdits,
  fallbackMessage: string = '',
): SocialRawContent {
  const current: SocialRawContent = parseSocialRawContent(raw) ?? { message: fallbackMessage, hashtags: [] };
  return {
    message: edits.message ?? current.message,
    hashtags: edits.hashtags ?? current.hashtags,
    ...(edits.callToAction !== undefined
      ? { callToAction: edits.callToAction }
      : current.callToAction !== undefined
        ? { callToAction: current.callToAction }
        : {}),
    ...(current.platform !== undefined ? { platform: current.platform } : {}),
  };
}

/** Parse a raw_content string, tolerating missing fields; null on absent/malformed input. */
export function parseSocialRawContent(raw: string | null | undefined): SocialRawContent | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: Record<string, unknown> = JSON.parse(raw);
    return {
      message: typeof parsed.message === 'string' ? parsed.message : '',
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h): h is string => typeof h === 'string') : [],
      ...(typeof parsed.callToAction === 'string' ? { callToAction: parsed.callToAction } : {}),
      ...(parsed.platform === 'facebook' || parsed.platform === 'instagram' ? { platform: parsed.platform } : {}),
    };
  } catch {
    return null;
  }
}
