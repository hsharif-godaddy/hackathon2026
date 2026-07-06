import type { DesignKit } from '@/lib/design-kits'

export type DesignKitTone = 'light' | 'dark'

export type DesignKitAttribute =
  | 'bold'
  | 'elegant'
  | 'warm'
  | 'editorial'
  | 'clean'
  | 'professional'

export type DesignKitFilter = DesignKitTone | DesignKitAttribute

const LUMINANCE_THRESHOLD = 0.45

const ATTRIBUTE_KEYWORDS: Record<DesignKitAttribute, readonly string[]> = {
  bold: ['bold', 'dramatic', 'strong', 'vibrant', 'high-contrast', 'expressive'],
  elegant: ['elegant', 'luxury', 'refined', 'sophisticated', 'premium', 'upscale'],
  warm: ['warm', 'earthy', 'organic', 'cozy', 'inviting', 'rustic'],
  editorial: ['editorial', 'magazine', 'typography', 'asymmetric', 'storytelling'],
  clean: ['clean', 'minimal', 'simple', 'spacious', 'airy', 'modern'],
  professional: ['professional', 'corporate', 'trustworthy', 'finance', 'legal', 'consulting', 'b2b'],
}

const DARK_TONE_KEYWORDS = ['noir', 'moody', 'night', 'dark mode'] as const
const LIGHT_TONE_KEYWORDS = ['bright', 'airy', 'light mode'] as const

export interface ClassifyDesignKitInput {
  slug?: string
  tags?: string[]
  design?: {
    palette?: {
      background?: string
    }
  }
}

/** Curated tone + attributes for the design-kit gallery (slug keys are lowercase). */
export const DESIGN_KIT_CLASSIFICATION_OVERRIDES: Readonly<
  Record<string, { tone: DesignKitTone; attributes: readonly DesignKitAttribute[] }>
> = {
  aether: { tone: 'light', attributes: ['clean', 'professional'] },
  alder: { tone: 'light', attributes: ['warm', 'clean', 'professional'] },
  ascent: { tone: 'dark', attributes: ['elegant', 'editorial'] },
  aura: { tone: 'light', attributes: ['elegant', 'warm', 'editorial', 'clean'] },
  bordeaux: { tone: 'dark', attributes: ['bold', 'elegant'] },
  canopy: { tone: 'dark', attributes: ['clean', 'professional'] },
  canvas: { tone: 'light', attributes: ['clean', 'professional'] },
  estelle: { tone: 'light', attributes: ['warm', 'elegant', 'editorial'] },
  fieldnote: { tone: 'light', attributes: ['warm', 'editorial'] },
  forge: { tone: 'dark', attributes: ['bold', 'professional'] },
  foundry: { tone: 'dark', attributes: ['warm', 'professional'] },
  haven: { tone: 'light', attributes: ['warm', 'elegant'] },
  interlude: { tone: 'light', attributes: ['clean', 'elegant'] },
  linden: { tone: 'dark', attributes: ['editorial'] },
  meridian: { tone: 'dark', attributes: ['clean', 'professional'] },
  nexus: { tone: 'dark', attributes: ['bold', 'clean'] },
  nova: { tone: 'light', attributes: ['bold', 'warm', 'clean'] },
  obsidian: { tone: 'dark', attributes: ['elegant'] },
  outland: { tone: 'dark', attributes: ['warm', 'editorial'] },
  poise: { tone: 'light', attributes: ['clean', 'professional'] },
  pulse: { tone: 'light', attributes: ['bold', 'clean'] },
  reverie: { tone: 'light', attributes: ['warm', 'elegant'] },
  tempo: { tone: 'light', attributes: ['bold', 'clean'] },
  terra: { tone: 'light', attributes: ['warm', 'editorial'] },
  vale: { tone: 'light', attributes: ['elegant', 'warm'] },
  velocity: { tone: 'dark', attributes: ['bold'] },
  voltage: { tone: 'dark', attributes: ['bold', 'clean'] },
  zest: { tone: 'light', attributes: ['bold', 'clean'] },
}

function parseHexColor(hex: string): [number, number, number] | null {
  const normalized = hex.trim().replace(/^#/, '')
  if (normalized.length === 3) {
    const [r, g, b] = normalized.split('')
    return [
      Number.parseInt(`${r}${r}`, 16),
      Number.parseInt(`${g}${g}`, 16),
      Number.parseInt(`${b}${b}`, 16),
    ]
  }
  if (normalized.length === 6 && /^[0-9a-f]+$/i.test(normalized)) {
    return [
      Number.parseInt(normalized.slice(0, 2), 16),
      Number.parseInt(normalized.slice(2, 4), 16),
      Number.parseInt(normalized.slice(4, 6), 16),
    ]
  }
  return null
}

function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (value: number): number => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function luminanceFromHex(hex: string): number | null {
  const rgb = parseHexColor(hex)
  if (!rgb) return null
  return relativeLuminance(rgb[0], rgb[1], rgb[2])
}

export function classifyTone(input: ClassifyDesignKitInput): DesignKitTone {
  const tags = (input.tags ?? []).map((tag) => tag.toLowerCase().trim())

  if (tags.includes('dark')) return 'dark'
  if (tags.includes('light')) return 'light'

  const background = input.design?.palette?.background
  if (background) {
    const luminance = luminanceFromHex(background)
    if (luminance !== null) {
      return luminance >= LUMINANCE_THRESHOLD ? 'light' : 'dark'
    }
  }

  const tagText = tags.join(' ')
  if (DARK_TONE_KEYWORDS.some((keyword) => tagText.includes(keyword))) return 'dark'
  if (LIGHT_TONE_KEYWORDS.some((keyword) => tagText.includes(keyword))) return 'light'

  return 'light'
}

export function classifyAttributes(tags?: string[]): DesignKitAttribute[] {
  const tagText = (tags ?? []).map((tag) => tag.toLowerCase()).join(' ')
  return (Object.entries(ATTRIBUTE_KEYWORDS) as [DesignKitAttribute, readonly string[]][])
    .filter(([, keywords]) => keywords.some((keyword) => tagText.includes(keyword)))
    .map(([attribute]) => attribute)
}

export function classifyDesignKit(raw: ClassifyDesignKitInput): {
  tone: DesignKitTone
  attributes: DesignKitAttribute[]
} {
  const slugKey = raw.slug?.toLowerCase()
  if (slugKey) {
    const override = DESIGN_KIT_CLASSIFICATION_OVERRIDES[slugKey]
    if (override) {
      return { tone: override.tone, attributes: [...override.attributes] }
    }
  }

  return {
    tone: classifyTone(raw),
    attributes: classifyAttributes(raw.tags),
  }
}

function isDesignKitTone(filter: DesignKitFilter): filter is DesignKitTone {
  return filter === 'light' || filter === 'dark'
}

export function filterDesignKits(
  kits: DesignKit[],
  filter: DesignKitFilter | null,
): DesignKit[] {
  if (filter === null) return kits
  if (isDesignKitTone(filter)) {
    return kits.filter((kit) => kit.tone === filter)
  }
  return kits.filter((kit) => kit.attributes.includes(filter))
}

export function formatAttributes(attributes: DesignKitAttribute[]): string {
  return attributes
    .map((attribute) => attribute.charAt(0).toUpperCase() + attribute.slice(1))
    .join(' · ')
}
