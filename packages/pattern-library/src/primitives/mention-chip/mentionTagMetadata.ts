/** HTML tag → human-readable label used in element-mention chips. */
export const MENTION_TAG_LABELS: Record<string, string> = {
  h1: 'Title',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  p: 'Text',
  span: 'Text',
  blockquote: 'Quote',
  figcaption: 'Caption',
  img: 'Image',
  picture: 'Image',
  video: 'Video',
  svg: 'Icon',
  a: 'Link',
  button: 'Button',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  code: 'Code',
  pre: 'Code',
  section: 'Section',
  nav: 'Nav',
  header: 'Header',
  footer: 'Footer',
};

export const MENTION_TAG_ICONS: Record<string, string> = {
  h1: 'text-highlight',
  h2: 'text-highlight',
  h3: 'text-highlight',
  h4: 'text-highlight',
  h5: 'text-highlight',
  h6: 'text-highlight',
  p: 'text-highlight',
  span: 'text-highlight',
  blockquote: 'text-highlight',
  figcaption: 'text-highlight',
  img: 'image',
  picture: 'image',
  video: 'video',
  svg: 'shapes',
  a: 'create-button',
  button: 'create-button',
  ul: 'bulleted-list',
  ol: 'bulleted-list',
  li: 'bulleted-list',
  code: 'code',
  pre: 'code',
  section: 'layout',
  nav: 'create-nav',
  header: 'layout',
  footer: 'layout',
};

export const MENTION_TAG_DEFAULT_ICON = 'layout';

function normalizeTagName(tagName: string): string {
  return tagName.toLowerCase();
}

export function getMentionTagLabel(tagName: string): string {
  const normalized = normalizeTagName(tagName);
  return MENTION_TAG_LABELS[normalized] ?? tagName;
}

export function getMentionTagIcon(tagName: string): string {
  const normalized = normalizeTagName(tagName);
  return MENTION_TAG_ICONS[normalized] ?? MENTION_TAG_DEFAULT_ICON;
}
