import { describe, expect, it } from 'vitest';

import type { SiteContactInfo } from '../../../types/rebuild.js';
import { buildContactBlock } from '../user-prompt-builder.js';

describe('buildContactBlock — WhatsApp click-to-chat', () => {
  it('renders a wa.me link with prefilled message from phone+text', () => {
    const contact: SiteContactInfo = {
      social: [{ platform: 'whatsapp', url: 'https://wa.me/15551234567?text=Hi there', phone: '15551234567', text: 'Hi there' }],
    };
    const out = buildContactBlock(contact);
    expect(out).toContain('https://wa.me/15551234567?text=Hi%20there');
    expect(out).toContain('prefilled message: "Hi there"');
  });

  it('rebuilds wa.me from phone even when source url uses the whatsapp:// app scheme', () => {
    const contact: SiteContactInfo = {
      social: [{ platform: 'whatsapp', url: 'whatsapp://send?phone=15551234567&text=Hi', phone: '15551234567', text: 'Hi' }],
    };
    const out = buildContactBlock(contact);
    expect(out).toContain('https://wa.me/15551234567?text=Hi');
    expect(out).not.toContain('whatsapp://');
  });

  it('omits the ?text= query when there is no prefilled text', () => {
    const contact: SiteContactInfo = {
      social: [{ platform: 'whatsapp', url: 'https://wa.me/15551234567', phone: '15551234567' }],
    };
    const out = buildContactBlock(contact);
    expect(out).toContain('https://wa.me/15551234567');
    expect(out).not.toContain('?text=');
  });

  it('matches the platform case-insensitively (WhatsApp / WHATSAPP)', () => {
    const contact: SiteContactInfo = {
      social: [{ platform: 'WhatsApp', url: 'whatsapp://send?phone=15551234567', phone: '15551234567' }],
    };
    const out = buildContactBlock(contact);
    expect(out).toContain('https://wa.me/15551234567');
    expect(out).not.toContain('whatsapp://');
  });

  it('falls back to platform: url for non-WhatsApp entries', () => {
    const contact: SiteContactInfo = {
      social: [{ platform: 'instagram', url: 'https://www.instagram.com/example' }],
    };
    const out = buildContactBlock(contact);
    expect(out).toContain('instagram: https://www.instagram.com/example');
  });
});
