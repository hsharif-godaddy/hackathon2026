import type { FontPairing } from './types.js';

/**
 * Professional font theme presets for websites with header/body pairings.
 * Single source of truth — imported by both the agents service and the app.
 */
export const FONT_THEMES: Record<string, FontPairing> = {
  'modern-professional': {
    name: 'Modern Professional',
    description: 'Clean sans-serif pairing. Perfect for tech, SaaS, and corporate sites.',
    headerFont: { name: 'Montserrat', weights: ['600', '700'], category: 'sans-serif' },
    bodyFont: { name: 'Inter', weights: ['400', '500', '600'], category: 'sans-serif' },
  },
  'elegant-serif': {
    name: 'Elegant Serif',
    description: 'Sophisticated serif pairing. Ideal for publishing, blogs, and editorial.',
    headerFont: { name: 'Playfair Display', weights: ['600', '700'], category: 'serif' },
    bodyFont: { name: 'Lora', weights: ['400', '500', '600'], category: 'serif' },
  },
  'bold-modern': {
    name: 'Bold Modern',
    description: 'Strong geometric headers with readable body. Great for agencies and portfolios.',
    headerFont: { name: 'Bebas Neue', weights: ['400'], category: 'sans-serif' },
    bodyFont: { name: 'Work Sans', weights: ['400', '500', '600'], category: 'sans-serif' },
  },
  'classic-formal': {
    name: 'Classic Formal',
    description: 'Traditional serif headers with clean body. Excellent for law, finance, luxury.',
    headerFont: { name: 'Merriweather', weights: ['700', '900'], category: 'serif' },
    bodyFont: { name: 'Source Sans 3', weights: ['400', '500', '600'], category: 'sans-serif' },
  },
};
