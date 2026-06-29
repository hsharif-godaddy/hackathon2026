/**
 * Default English copy for generate_video tool renderer keys (dev fallback until published in @airo-app-builder/aab).
 */
export const VIDEO_TOOL_DEFAULT_MESSAGES = {
  builder_tools_active_video_generate: 'Generating video…',
  builder_tools_active_video_generate_count:
    '{count, plural, one {Generating # video…} other {Generating # videos…}}',
  builder_tools_video_generate_failed_count:
    '{count, plural, one {# video generation failed} other {# video generations failed}}',
  builder_tools_video_generated_prompt: 'Generated video: "{prompt}"',
  builder_tools_video_modal_title: 'AI Generated Video',
  builder_tools_video_ai_generated_aria: 'AI generated video',
} satisfies Record<string, string>

export type VideoToolKey = keyof typeof VIDEO_TOOL_DEFAULT_MESSAGES

export function defaultMessageForVideoToolKey(key: VideoToolKey): string {
  return VIDEO_TOOL_DEFAULT_MESSAGES[key]
}
