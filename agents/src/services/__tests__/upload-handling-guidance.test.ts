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

  it('deflected hero upload (Surface 1 routed to a side slot) → guidance must NOT claim it is the hero; describe-before-replace required', () => {
    // Review #1: deflected hero must NOT be framed as "the hero" (agent would still swap displayed hero).
    const out: string = buildUploadHandlingGuidance(
      input({
        placementIntent: 'display_on_site',
        assetRole: 'hero_image',
        slotUrl: '/airo-assets/images/uploads/hero-coffee-beans',
        deflectedFromCanonical: true,
      }),
    );
    expect(out).not.toMatch(/this is the hero image/);
    expect(out).toContain('NEW slot');
    expect(out).toContain('previously accepted');
    expect(out).toContain('FIRST describe');
    expect(out).toMatch(/yes, replace it/);
    expect(out).toContain('/airo-assets/images/uploads/hero-coffee-beans');
  });

  it('display_on_site without slotUrl → describe-before-replace required for the REPLACING branch (review finding #2)', () => {
    // Review #2: display_on_site path bypasses Surface 1 guard via explicit slotName — needs the same safeguard.
    const out: string = buildUploadHandlingGuidance(
      input({ placementIntent: 'display_on_site', assetRole: null, storedUploadFilename: 'photo-1.jpg' }),
    );
    expect(out).toContain('FIRST describe');
    expect(out).toMatch(/yes, replace it/);
    expect(out).toContain('REPLACING');
    expect(out).toContain('NEW slot');
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

  // AIROBUILD-2789 Surface 2 — unclear-branch guidance must stop the agent inferring placement from vague sentiment and require describe-before-replace.
  describe('unclear branch — Surface 2 safeguards', () => {
    it('lists vague positive sentiment as NOT a placement instruction (with explicit examples)', () => {
      const out: string = buildUploadHandlingGuidance(input({ placementIntent: 'unclear' }));
      expect(out).toContain('vague positive sentiment');
      expect(out).toContain('NOT a placement instruction');
      expect(out).toContain('I like this');
      expect(out).toContain('nice photo');
    });

    it('narrows "yes" — bare yes counts only when answering a yes/no placement question the agent just asked', () => {
      const out: string = buildUploadHandlingGuidance(input({ placementIntent: 'unclear' }));
      expect(out).toMatch(/bare ['"]?yes['"]?/i);
      expect(out).toContain('yes/no placement question');
    });

    it('describe-before-replace: before clobbering an existing element\'s slot, agent must describe current contents and wait for explicit confirmation', () => {
      const out: string = buildUploadHandlingGuidance(input({ placementIntent: 'unclear' }));
      expect(out).toContain('FIRST describe');
      expect(out).toMatch(/wait for (an )?explicit/i);
    });

    it('offers a non-destructive alternative — keep both by registering to a new slot name', () => {
      const out: string = buildUploadHandlingGuidance(input({ placementIntent: 'unclear' }));
      expect(out).toMatch(/uploads\/hero-/);
      expect(out).toMatch(/keep both|new slot/i);
    });

    it('still tells the agent the import_upload call shape so an explicit confirmation remains actionable', () => {
      const out: string = buildUploadHandlingGuidance(
        input({ placementIntent: 'unclear', storedUploadFilename: 'app123_456_photo.jpg' }),
      );
      expect(out).toContain('import_upload');
      expect(out).toContain('app123_456_photo.jpg');
    });
  });

  // Placement hygiene — stop the wrong-image correction loop from minting new
  // slots, reusing stale uploads, or assigning multi-image batches by order.
  describe('placement hygiene (wrong-image loop guards)', () => {
    it('display_on_site: reuse the existing slot on a correction, never mint -v2/-v3 variants', () => {
      const out: string = buildUploadHandlingGuidance(input({ placementIntent: 'display_on_site' }));
      expect(out).toContain('SAME slot path');
      expect(out).toMatch(/NEVER create a new slot variant/i);
      expect(out).toContain('-v2');
    });

    it('unclear: also carries the correction + current-turn + multi-image hygiene', () => {
      const out: string = buildUploadHandlingGuidance(input({ placementIntent: 'unclear' }));
      expect(out).toMatch(/NEVER create a new slot variant/i);
      expect(out).toContain('THIS turn');
      expect(out).toContain('MULTIPLE IMAGES AT ONCE');
    });

    it('warns against assigning multiple look-alike images by upload order', () => {
      const out: string = buildUploadHandlingGuidance(input({ placementIntent: 'display_on_site' }));
      expect(out).toMatch(/do NOT assign them by upload order/i);
      expect(out).toMatch(/swapped/i);
    });

    it('does NOT inject placement hygiene into reference_only or logo branches', () => {
      const ref: string = buildUploadHandlingGuidance(input({ placementIntent: 'reference_only' }));
      const logo: string = buildUploadHandlingGuidance(input({ assetRole: 'logo', placementIntent: 'display_on_site' }));
      expect(ref).not.toContain('SAME slot path');
      expect(logo).not.toContain('SAME slot path');
    });
  });

  describe('use-uploaded-not-stock guardrail (no Getty search on a "place this file" turn)', () => {
    it('canonical hero/background placement forbids stock search / generated substitutes', () => {
      const out: string = buildUploadHandlingGuidance(
        input({ placementIntent: 'display_on_site', assetRole: 'hero_image', slotUrl: '/airo-assets/images/pages/home/hero' }),
      );
      expect(out).toMatch(/Do NOT run a Getty\/stock `search`/i);
      expect(out).toMatch(/source of truth/i);
    });

    it('generic display placement forbids stock search', () => {
      const out: string = buildUploadHandlingGuidance(
        input({ placementIntent: 'display_on_site', assetRole: null, storedUploadFilename: 'stored-x.jpg' }),
      );
      expect(out).toMatch(/Do NOT run a Getty\/stock `search`/i);
    });

    it('unclear branch carries the no-stock guardrail for once-placed', () => {
      const out: string = buildUploadHandlingGuidance(input({ placementIntent: 'unclear' }));
      expect(out).toMatch(/Do NOT run a Getty\/stock `search`/i);
    });

    it('reference_only and logo branches do NOT carry the no-stock guardrail (they legitimately generate/derive)', () => {
      const ref: string = buildUploadHandlingGuidance(input({ placementIntent: 'reference_only' }));
      const logo: string = buildUploadHandlingGuidance(input({ assetRole: 'logo', placementIntent: 'display_on_site' }));
      expect(ref).not.toMatch(/Do NOT run a Getty\/stock `search`/i);
      expect(logo).not.toMatch(/Do NOT run a Getty\/stock `search`/i);
    });
  });

  describe('storedUploadFilename sanitization (it reaches an agent-facing code span)', () => {
    it('strips backticks/newlines from the stored filename in the display_on_site import_upload span', () => {
      const out: string = buildUploadHandlingGuidance(
        input({ placementIntent: 'display_on_site', assetRole: null, storedUploadFilename: 'evil`\n.jpg' }),
      );
      expect(out).toContain('filename: "evil__.jpg"');
      expect(out).not.toContain('evil`');
    });

    it('strips backticks/newlines from the stored filename in the unclear import_upload span', () => {
      const out: string = buildUploadHandlingGuidance(
        input({ placementIntent: 'unclear', storedUploadFilename: 'evil`\n.jpg' }),
      );
      expect(out).toContain('filename: "evil__.jpg"');
      expect(out).not.toContain('evil`');
    });
  });
});
