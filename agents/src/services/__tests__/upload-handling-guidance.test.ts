import { describe, it, expect } from 'vitest';
import {
  buildUploadHandlingGuidance,
  shouldAutoRegisterUpload,
  type UploadHandlingInput,
} from '../upload-handling-guidance.js';

function input(overrides: Partial<UploadHandlingInput> = {}): UploadHandlingInput {
  return {
    fileName: 'photo.jpg',
    assetRole: null,
    placementIntent: 'unclear',
    ...overrides,
  };
}

describe('shouldAutoRegisterUpload', () => {
  it('is true only for display_on_site hero/background images', () => {
    expect(shouldAutoRegisterUpload(input({ placementIntent: 'display_on_site', assetRole: 'hero_image' }))).toBe(true);
    expect(shouldAutoRegisterUpload(input({ placementIntent: 'display_on_site', assetRole: 'background' }))).toBe(true);
  });

  it('is false for logos, references, unclear intent, or null role', () => {
    expect(shouldAutoRegisterUpload(input({ placementIntent: 'display_on_site', assetRole: 'logo' }))).toBe(false);
    expect(shouldAutoRegisterUpload(input({ placementIntent: 'display_on_site', assetRole: null }))).toBe(false);
    expect(shouldAutoRegisterUpload(input({ placementIntent: 'reference_only', assetRole: 'hero_image' }))).toBe(false);
    expect(shouldAutoRegisterUpload(input({ placementIntent: 'unclear', assetRole: 'hero_image' }))).toBe(false);
  });
});

describe('buildUploadHandlingGuidance', () => {
  it('always names the file and tells the agent to follow this block', () => {
    const out = buildUploadHandlingGuidance(input({ fileName: 'hero.jpg' }));
    expect(out).toContain('## Upload handling');
    expect(out).toContain('`hero.jpg`');
  });

  it('instructs the agent to keep slot paths/URLs out of the user-facing reply', () => {
    const out = buildUploadHandlingGuidance(input({ placementIntent: 'display_on_site', assetRole: 'hero_image', slotUrl: '/airo-assets/images/pages/home/hero' }));
    expect(out).toContain('plain language');
    expect(out).toContain('Do NOT expose slot names');
    // The slot URL is still present for code use (internal), just not for the reply.
    expect(out).toContain('/airo-assets/images/pages/home/hero');
  });

  it('hero/background reuse their single canonical slot URL', () => {
    const hero = buildUploadHandlingGuidance(input({ placementIntent: 'display_on_site', assetRole: 'hero_image', slotUrl: '/airo-assets/images/pages/home/hero' }));
    expect(hero).toContain('/airo-assets/images/pages/home/hero');
    expect(hero).toContain('hero image');
  });

  it('generic image with a prior slot URL does NOT reuse it — steers a per-position import_upload (add vs replace)', () => {
    // A null-role image already placed once (slotUrl persisted). A later
    // placement must create its own slot, not couple to the prior one.
    const out = buildUploadHandlingGuidance(input({
      placementIntent: 'display_on_site',
      assetRole: null,
      slotUrl: '/airo-assets/images/menu/latte-art',
      storedUploadFilename: 'stored.jpg',
    }));
    expect(out).not.toContain('/airo-assets/images/menu/latte-art');
    expect(out).toContain('import_upload');
    expect(out).toContain('NEW slot name');
    expect(out).toContain('stored.jpg');
  });

  it('reference_only → do not place or register, generate a new logo from the reference', () => {
    const out = buildUploadHandlingGuidance(input({ placementIntent: 'reference_only' }));
    expect(out).toContain('reference/inspiration only');
    expect(out).toContain('do NOT place');
    expect(out).toContain('generate a NEW one');
    expect(out).not.toContain('import_upload');
    // Shared guidance must not name skills (self-containment rule).
    expect(out).not.toContain('media-logo');
    expect(out).not.toContain('media-upload');
  });

  it('logo → copy to public/assets, not a slot', () => {
    const out = buildUploadHandlingGuidance(input({ placementIntent: 'display_on_site', assetRole: 'logo' }));
    expect(out).toContain('logo on the site');
    expect(out).toContain('public/assets/');
    expect(out).toContain('not a media slot');
    expect(out).not.toContain('import_upload');
  });

  it('slotUrl present → use the slot URL, do not copy to public/assets', () => {
    const out = buildUploadHandlingGuidance(
      input({
        placementIntent: 'display_on_site',
        assetRole: 'hero_image',
        slotUrl: '/airo-assets/images/uploads/hero-x',
      }),
    );
    expect(out).toContain('/airo-assets/images/uploads/hero-x');
    expect(out).toContain('Do NOT copy to public/assets');
  });

  it('display_on_site without a slot → instruct import_upload with the stored filename (no skill name)', () => {
    const out = buildUploadHandlingGuidance(
      input({ placementIntent: 'display_on_site', assetRole: null, storedUploadFilename: 'stored-x.jpg' }),
    );
    expect(out).toContain('import_upload');
    expect(out).toContain('stored-x.jpg');
    // Shared guidance must not name skills (self-containment rule).
    expect(out).not.toContain('media-upload');
  });

  it('unclear → ask where it goes but carry filename + import_upload so a later "yes" can act', () => {
    const out = buildUploadHandlingGuidance(
      input({ placementIntent: 'unclear', storedUploadFilename: 'app123_456_photo.jpg' }),
    );
    expect(out).toContain('unclear');
    expect(out).toContain('Ask where');
    // The confirmation path must be actionable, not a dead-end: it carries the
    // stored filename and the import_upload mechanics so a follow-up "yes"
    // (in any later turn) lets the agent place the image without losing context.
    expect(out).toContain('import_upload');
    expect(out).toContain('app123_456_photo.jpg');
    expect(out).not.toContain('do not place');
    // Replacing an existing image must reuse that element's slot, not mint a new
    // one — same add-vs-replace rule the display_on_site branch carries.
    expect(out).toContain('REPLACING');
  });

  it('unclear without a stored filename falls back to the listUploadedFiles placeholder', () => {
    const out = buildUploadHandlingGuidance(input({ placementIntent: 'unclear' }));
    expect(out).toContain('import_upload');
    expect(out).toContain('<stored-upload-filename-from-listUploadedFiles>');
  });

  it('non-image documents are labelled as document', () => {
    const out = buildUploadHandlingGuidance(input({ fileName: 'spec.pdf', isImage: false }));
    expect(out).toContain('File type: document');
  });
});
