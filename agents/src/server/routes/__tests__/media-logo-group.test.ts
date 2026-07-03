import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../../../logging/index.js', () => {
  const instance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: function child() { return instance; },
  };
  return { logger: instance, Logger: { create: () => instance } };
});

const mockGetSlot = vi.fn();
const mockSetSlot = vi.fn();
const mockUpdateSlot = vi.fn();
const mockUpdateSlotOrFork = vi.fn();

vi.mock('../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    getSlot: (...args: unknown[]) => mockGetSlot(...args),
    setSlot: (...args: unknown[]) => mockSetSlot(...args),
    updateSlot: (...args: unknown[]) => mockUpdateSlot(...args),
    updateSlotOrFork: (...args: unknown[]) => mockUpdateSlotOrFork(...args),
  },
}));

vi.mock('../../../services/logo/LogoGenerationService.js', () => ({
  logoGenerationService: { cancel: vi.fn().mockResolvedValue({ cancelled: true }) },
}));

vi.mock('../../../services/logo/logo-slots.js', () => ({
  ALL_LOGO_SLOT_PATHS: ['logo/primary', 'logo/horizontal', 'logo/vertical', 'logo/favicon'],
  LOGO_SLOT_PATHS: { square: 'logo/primary', horizontal: 'logo/horizontal', vertical: 'logo/vertical' },
  FAVICON_SLOT_PATH: 'logo/favicon',
}));

const { default: mediaRouter } = await import('../media.js');

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/media', mediaRouter);
  return app;
}

describe('GET /media/:appId/logo/group/:groupId', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('returns slot info with matching group URLs', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, path: string) => {
      if (path === 'logo/primary') {
        return {
          success: true,
          slot: {
            currentUrl: 'https://cdn/primary.png',
            logoGroupId: 'group-a',
            logoSourceMap: { 'https://cdn/primary.png': { groupId: 'group-a' } },
          },
        };
      }
      if (path === 'logo/favicon') {
        return {
          success: true,
          slot: {
            currentUrl: 'https://cdn/fav.png',
            logoGroupId: 'group-a',
            logoSourceMap: { 'https://cdn/fav.png': { groupId: 'group-a' } },
          },
        };
      }
      return { success: true, slot: { currentUrl: '', logoSourceMap: {} } };
    });

    const res = await request(app)
      .get('/media/app-1/logo/group/group-a')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.groupId).toBe('group-a');
    expect(res.body.slots['logo/primary'].hasGroupUrl).toBe(true);
    expect(res.body.slots['logo/primary'].url).toBe('https://cdn/primary.png');
    expect(res.body.slots['logo/favicon'].hasGroupUrl).toBe(true);
  });

  it('reports hasGroupUrl:false for slots without the groupId', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: { currentUrl: 'https://cdn/other.png', logoSourceMap: { 'https://cdn/other.png': { groupId: 'group-b' } } },
    });

    const res = await request(app)
      .get('/media/app-1/logo/group/group-a')
      .expect(200);

    expect(res.body.slots['logo/primary'].hasGroupUrl).toBe(false);
  });

  it('handles getSlot failures gracefully (500)', async () => {
    mockGetSlot.mockRejectedValue(new Error('disk full'));

    const res = await request(app)
      .get('/media/app-1/logo/group/group-a')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

describe('PUT /media/:appId/logo/restore-group', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetSlot.mockResolvedValue(undefined);
    app = createApp();
  });

  it('swaps slots that have an alternative matching the groupId', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, path: string) => {
      if (path === 'logo/primary') {
        return {
          success: true,
          slot: {
            currentUrl: 'https://cdn/new.png',
            alternatives: ['https://cdn/old.png'],
            logoSourceMap: { 'https://cdn/old.png': { groupId: 'group-x' } },
          },
        };
      }
      return { success: true, slot: { currentUrl: '', alternatives: [] } };
    });

    const res = await request(app)
      .put('/media/app-1/logo/restore-group')
      .send({ groupId: 'group-x' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.restoredSlots).toContain('logo/primary');
    expect(mockSetSlot).toHaveBeenCalledWith('app-1', 'logo/primary', expect.objectContaining({
      currentUrl: 'https://cdn/old.png',
      logoGroupId: 'group-x',
    }));
  });

  it('skips slots already showing the correct URL (only sets groupId if needed)', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        currentUrl: 'https://cdn/target.png',
        alternatives: [],
        logoGroupId: 'group-x',
        logoSourceMap: { 'https://cdn/target.png': { groupId: 'group-x' } },
      },
    });

    const res = await request(app)
      .put('/media/app-1/logo/restore-group')
      .send({ groupId: 'group-x' })
      .expect(200);

    expect(res.body.restoredSlots).toEqual([]);
    expect(mockSetSlot).not.toHaveBeenCalled();
  });

  it('sets logoGroupId on a slot that shows correct URL but wrong group', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        currentUrl: 'https://cdn/target.png',
        alternatives: [],
        logoGroupId: 'old-group',
        logoSourceMap: { 'https://cdn/target.png': { groupId: 'group-x' } },
      },
    });

    const res = await request(app)
      .put('/media/app-1/logo/restore-group')
      .send({ groupId: 'group-x' })
      .expect(200);

    expect(res.body.restoredSlots).toEqual([]);
    expect(mockSetSlot).toHaveBeenCalledWith('app-1', expect.any(String), expect.objectContaining({
      logoGroupId: 'group-x',
    }));
  });

  it('returns 400 when groupId is missing', async () => {
    const res = await request(app)
      .put('/media/app-1/logo/restore-group')
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/required/);
  });

  it('returns 500 on unexpected error and includes partial restoredSlots', async () => {
    let callCount = 0;
    mockGetSlot.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new Error('disk exploded');
      return {
        success: true,
        slot: {
          currentUrl: 'https://cdn/current.png',
          alternatives: ['https://cdn/target.png'],
          logoSourceMap: { 'https://cdn/target.png': { groupId: 'grp' } },
        },
      };
    });

    const res = await request(app)
      .put('/media/app-1/logo/restore-group')
      .send({ groupId: 'grp' })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

describe('PUT /media/:appId/slots/:slotName — logoGroupId cascade', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetSlot.mockResolvedValue(undefined);
    app = createApp();
  });

  it('clears sibling logoGroupId when a logo slot is swapped to a different group', async () => {
    // The initial getSlot for pendingJobId check
    mockGetSlot.mockResolvedValueOnce({ success: true, slot: { currentUrl: 'https://cdn/old.png' } });

    // updateSlotOrFork returns a logo slot with a new group
    mockUpdateSlotOrFork.mockResolvedValueOnce({
      success: true,
      forked: false,
      slot: {
        mediaType: 'logo',
        currentUrl: 'https://cdn/new.png',
        logoSourceMap: { 'https://cdn/new.png': { groupId: 'new-group' } },
      },
      commitHash: 'abc',
    });

    // Cascade reads siblings
    mockGetSlot
      .mockResolvedValueOnce({
        success: true,
        slot: {
          currentUrl: 'https://cdn/sib.png',
          logoGroupId: 'old-group',
          logoSourceMap: { 'https://cdn/sib.png': { groupId: 'old-group' } },
        },
      })
      .mockResolvedValueOnce({ success: true, slot: { currentUrl: '' } })
      .mockResolvedValueOnce({ success: true, slot: { currentUrl: '' } });

    const res = await request(app)
      .put('/media/app-1/slots/logo/primary')
      .send({ newUrl: 'https://cdn/new.png' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockSetSlot).toHaveBeenCalledWith('app-1', expect.any(String), expect.objectContaining({
      logoGroupId: undefined,
    }));
  });

  it('does not cascade when the promoted logo has the same group as siblings', async () => {
    mockGetSlot.mockResolvedValueOnce({ success: true, slot: { currentUrl: 'https://cdn/old.png' } });

    mockUpdateSlotOrFork.mockResolvedValueOnce({
      success: true,
      forked: false,
      slot: {
        mediaType: 'logo',
        currentUrl: 'https://cdn/new.png',
        logoSourceMap: { 'https://cdn/new.png': { groupId: 'same-group' } },
      },
      commitHash: 'abc',
    });

    // Siblings have same group
    mockGetSlot
      .mockResolvedValueOnce({
        success: true,
        slot: { currentUrl: 'https://cdn/sib.png', logoGroupId: 'same-group', logoSourceMap: {} },
      })
      .mockResolvedValueOnce({ success: true, slot: { currentUrl: '' } })
      .mockResolvedValueOnce({ success: true, slot: { currentUrl: '' } });

    await request(app)
      .put('/media/app-1/slots/logo/primary')
      .send({ newUrl: 'https://cdn/new.png' })
      .expect(200);

    expect(mockSetSlot).not.toHaveBeenCalled();
  });

  it('does not cascade for non-logo slots', async () => {
    mockGetSlot.mockResolvedValueOnce({ success: true, slot: { currentUrl: 'https://cdn/old.png' } });

    mockUpdateSlotOrFork.mockResolvedValueOnce({
      success: true,
      forked: false,
      slot: { mediaType: 'image', currentUrl: 'https://cdn/new.png' },
      commitHash: 'abc',
    });

    await request(app)
      .put('/media/app-1/slots/pages/home/hero')
      .send({ newUrl: 'https://cdn/new.png' })
      .expect(200);

    // No sibling reads for non-logo slots
    expect(mockGetSlot).toHaveBeenCalledTimes(1); // only the pendingJobId check
  });
});
