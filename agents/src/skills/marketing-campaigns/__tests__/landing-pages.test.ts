import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../workspace/index.js', () => ({ createForWorkspace: vi.fn() }))

import { createForWorkspace } from '../../../workspace/index.js'
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js'
import { deleteCampaignLandingPages, deleteCampaignBlogPosts, MANIFEST_PATH, type LandingPageManifestEntry } from '../landing-pages.js'

const APP_ID: string = 'app1234567'

interface StubWorkspace {
  deletes: string[]
  writes: { path: string; content: string }[]
}

describe('deleteCampaignLandingPages', () => {
  beforeEach(() => {
    vi.mocked(createForWorkspace).mockReset()
  })

  function fakeManifestWorkspace(manifest: LandingPageManifestEntry[]): StubWorkspace {
    const deletes: string[] = []
    const writes: { path: string; content: string }[] = []
    vi.mocked(createForWorkspace).mockReturnValue({
      files: createStubWorkspaceFiles({
        readText: vi.fn(async ({ path }: { path: string }): Promise<string> => {
          if (path !== MANIFEST_PATH) throw new Error('not found')
          return JSON.stringify(manifest)
        }),
        delete: vi.fn(async ({ path }: { path: string }): Promise<unknown> => { deletes.push(path); return {} }),
        write: vi.fn(async (opts: { path: string; content: string }): Promise<unknown> => { writes.push(opts); return {} }),
      }),
    } as never)
    return { deletes, writes }
  }

  it('deletes the owned pages (and their .bak) and rewrites the manifest without them', async () => {
    const manifest: LandingPageManifestEntry[] = [
      { id: 'lp-aaa', slug: 'summer', componentPath: './summer.tsx', campaignId: 'camp_1' },
      { id: 'lp-bbb', slug: 'winter', componentPath: './winter.tsx', campaignId: 'camp_2' },
    ]
    const { deletes, writes } = fakeManifestWorkspace(manifest)

    await deleteCampaignLandingPages(APP_ID, 'camp_1')

    expect(deletes).toEqual(['src/pages/lp/summer.tsx', 'src/pages/lp/summer.tsx.bak'])
    expect(writes).toHaveLength(1)
    const remaining: LandingPageManifestEntry[] = JSON.parse(writes[0].content)
    expect(remaining).toEqual([{ id: 'lp-bbb', slug: 'winter', componentPath: './winter.tsx', campaignId: 'camp_2' }])
  })

  it('no-ops (no delete, no manifest rewrite) when no entry belongs to the campaign', async () => {
    const { deletes, writes } = fakeManifestWorkspace([
      { id: 'lp-bbb', slug: 'winter', componentPath: './winter.tsx', campaignId: 'camp_2' },
    ])

    await deleteCampaignLandingPages(APP_ID, 'camp_1')

    expect(deletes).toEqual([])
    expect(writes).toEqual([])
  })
})

describe('deleteCampaignBlogPosts', () => {
  beforeEach(() => {
    vi.mocked(createForWorkspace).mockReset()
  })

  function fakeBlogWorkspace(mdByPath: Record<string, string>): { deletes: string[] } {
    const deletes: string[] = []
    const paths: string[] = Object.keys(mdByPath)
    vi.mocked(createForWorkspace).mockReturnValue({
      files: createStubWorkspaceFiles({
        tree: vi.fn(async (): Promise<{ entries: { path: string }[] }> => ({ entries: paths.map((path: string): { path: string } => ({ path })) })),
        // Stub readText (raw content), matching what deleteCampaignBlogPosts uses. view() would return
        // cat -n line-numbered content, so stubbing view here would diverge from the production path.
        readText: vi.fn(async ({ path }: { path: string }): Promise<string> => {
          if (mdByPath[path] === undefined) throw new Error('not found')
          return mdByPath[path]
        }),
        delete: vi.fn(async ({ path }: { path: string }): Promise<unknown> => { deletes.push(path); return {} }),
      }),
    } as never)
    return { deletes }
  }

  it('deletes only posts whose frontmatter campaignId matches (plus their .bak)', async () => {
    const { deletes } = fakeBlogWorkspace({
      'src/content/data/blog/owned.md': "---\ntitle: 'A'\ncampaignId: 'camp_1'\n---\n\nBody.",
      'src/content/data/blog/other.md': "---\ntitle: 'B'\ncampaignId: 'camp_2'\n---\n\nBody.",
      'src/content/data/blog/orphan.md': "---\ntitle: 'C'\n---\n\nNo campaignId.",
    })

    await deleteCampaignBlogPosts(APP_ID, 'camp_1')

    expect(deletes).toEqual(['src/content/data/blog/owned.md', 'src/content/data/blog/owned.md.bak'])
  })

  it('deletes nothing when no post carries the campaignId', async () => {
    const { deletes } = fakeBlogWorkspace({
      'src/content/data/blog/orphan.md': "---\ntitle: 'C'\n---\n\nNo campaignId.",
    })

    await deleteCampaignBlogPosts(APP_ID, 'camp_1')

    expect(deletes).toEqual([])
  })
})
