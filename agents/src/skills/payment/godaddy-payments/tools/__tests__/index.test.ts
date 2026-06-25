import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExecuteAction,
  mockFindBindingByAppId,
  mockCreateForWorkspace,
  mockGetActionService,
  mockUpsertBinding,
  mockWorkspaceWrite,
  mockWorkspaceView,
} = vi.hoisted(() => ({
  mockExecuteAction: vi.fn(),
  mockFindBindingByAppId: vi.fn(),
  mockCreateForWorkspace: vi.fn(),
  mockGetActionService: vi.fn(),
  mockUpsertBinding: vi.fn(),
  mockWorkspaceWrite: vi.fn(),
  mockWorkspaceView: vi.fn(),
}));

vi.mock('../../../../../server/agent-runtime.js', () => ({
  getActionService: mockGetActionService,
}));

vi.mock('../../../../../database/repositories/AppCommerceBindingRepository.js', () => ({
  AppCommerceBindingRepository: vi.fn().mockImplementation(function () {
    return {
      findByAppId: mockFindBindingByAppId,
      upsert: mockUpsertBinding,
    };
  }),
}));

vi.mock('../../../../../workspace/index.js', () => ({
  createForWorkspace: mockCreateForWorkspace,
}));

const {
  provisionTool,
  storeChannelsGetTool,
  storeGetTool,
  storeListTool,
  tools,
} = await import('../index.js');

function runTool(
  tool: {
    execute: (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>;
  },
  input: Record<string, unknown>,
  context: Record<string, unknown> = { socketId: 'socket-1' }
) {
  return tool.execute(input, context);
}

describe('GoDaddy Payments skill MCP tools', () => {
  beforeEach(() => {
    mockExecuteAction.mockReset();
    mockFindBindingByAppId.mockReset();
    mockGetActionService.mockReset();
    mockUpsertBinding.mockReset();
    mockGetActionService.mockReturnValue({
      executeAction: mockExecuteAction,
    });
    mockCreateForWorkspace.mockReturnValue({
      files: {
        view: mockWorkspaceView,
        write: mockWorkspaceWrite,
      },
    });
    mockWorkspaceWrite.mockResolvedValue({ bytesWritten: 100 });
    mockWorkspaceView.mockResolvedValue({
      content: '',
      encoding: 'utf-8',
      lines: 0,
      size: 0,
      truncated: false,
      path: '.env',
    });
    process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com';
    mockFindBindingByAppId.mockReturnValue(null);
    mockUpsertBinding.mockImplementation((params) => ({
      appId: params.appId,
      businessId: params.businessId ?? null,
      businessName: params.businessName ?? null,
      storeId: params.storeId ?? null,
      storeName: params.storeName ?? null,
      storeUrl: params.storeUrl ?? null,
      channelId: params.channelId ?? null,
      channelName: params.channelName ?? null,
      defaultLocationId: params.defaultLocationId ?? null,
      status: params.status,
      source: params.source,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  it('exports payment provision and read-only store diagnostics', () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'provision',
      'store_channels_get',
      'store_get',
      'store_list',
    ]);
  });

  describe('#provisionTool', () => {
    it('documents non-catalog checkout as lineItemData-only after provisioning', () => {
      expect(provisionTool.description).toContain('non-catalog payments');
      expect(provisionTool.description).toContain('lineItemData');
      expect(provisionTool.description).toContain('priceData');
      expect(provisionTool.description).toContain('unitPrice');
      expect(provisionTool.description).toContain('data.url');
      expect(provisionTool.description).toContain('data.redirectUrl');
      expect(provisionTool.description).toContain('Do not create products/SKUs');
      expect(provisionTool.description).toContain('commerce/ui');
    });

    it('installs server config templates that do not depend on import.meta.env for store routing', () => {
      const configPaths = [
        'src/skills/payment/godaddy-payments/templates/lib/commerce/config.ts',
        'src/skills/commerce/ui/templates/lib/commerce/config.ts',
      ];

      for (const configPath of configPaths) {
        const config = readFileSync(resolve(process.cwd(), configPath), 'utf-8');

        expect(config).toContain("readRuntimeValue('GODADDY_STORE_ID', 'VITE_GODADDY_STORE_ID')");
        expect(config).toContain(
          "readRuntimeValue('GODADDY_CHANNEL_ID', 'VITE_GODADDY_CHANNEL_ID')"
        );
        expect(config).not.toContain('import.meta.env.VITE_GODADDY_STORE_ID');
        expect(config).not.toContain('import.meta.env.VITE_GODADDY_CHANNEL_ID');
      }
    });

    it('documents cart checkout redirect behavior', () => {
      const skill = readFileSync(
        resolve(process.cwd(), 'src/skills/payment/godaddy-payments/skill.md'),
        'utf-8'
      );

      expect(skill).toContain('### Cart Checkout');
      expect(skill).toContain('draftOrderId');
      expect(skill).toContain('The response is `{ url, id, draftOrderId }`');
      expect(skill).toContain('data.url');
      expect(skill).toContain('do not render a replacement shipping/payment checkout page');
      expect(skill).toContain('data.redirectUrl');
    });

    it('resumes from an existing Commerce channel_ready binding instead of asking for store setup again', async () => {
      const savedBinding = {
        appId: 'app-1',
        businessId: 'business-1',
        storeId: 'store-1',
        channelId: 'channel-1',
        status: 'channel_ready',
        source: 'tool_channel_ensure',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockFindBindingByAppId.mockReturnValue(savedBinding);
      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        result: {
          structuredContent: {
            data: {
              storeId: 'store-1',
              displayName: 'Shop',
              paymentsManualSetupRequired: false,
            },
          },
        },
      });

      const result = await runTool(
        provisionTool,
        {},
        { socketId: 'socket-1', metadata: { appId: 'app-1' } }
      );

      expect(mockExecuteAction).toHaveBeenCalledTimes(1);
      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            request: expect.objectContaining({
              params: {
                name: 'commerce_store_setup',
                arguments: {
                  businessId: 'business-1',
                  storeId: 'store-1',
                },
              },
            }),
          }),
        })
      );
      expect(mockWorkspaceWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '.env',
          content: expect.stringContaining('VITE_GODADDY_STORE_ID=store-1'),
        })
      );
      expect(mockWorkspaceWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '.env',
          content: expect.stringContaining('GODADDY_STORE_ID=store-1'),
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          status: 'ready',
          storeId: 'store-1',
          channelId: 'channel-1',
          paymentSetupReady: true,
          requiredNextActions: expect.arrayContaining([
            expect.stringContaining('lineItemData'),
            expect.stringContaining('data.url'),
            expect.stringContaining('redirectUrl'),
          ]),
          forbiddenActions: expect.arrayContaining([
            expect.stringContaining('Do not create catalog products or SKUs'),
          ]),
        })
      );
    });

    it('returns payments_manual_required from the existing binding verification path', async () => {
      const savedBinding = {
        appId: 'app-1',
        storeId: 'store-1',
        channelId: 'channel-1',
        status: 'channel_ready',
        source: 'tool_channel_ensure',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockFindBindingByAppId.mockReturnValue(savedBinding);
      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        result: {
          structuredContent: {
            data: {
              storeId: 'store-1',
              paymentsManualSetupRequired: true,
              manageUrl: 'https://commerce.godaddy.com/manage',
            },
          },
        },
      });

      const result = await runTool(
        provisionTool,
        {},
        { socketId: 'socket-1', metadata: { appId: 'app-1' } }
      );

      expect(result).toEqual(
        expect.objectContaining({
          status: 'payments_manual_required',
          manageUrl: 'https://commerce.godaddy.com/manage',
        })
      );
      expect(mockWorkspaceWrite).not.toHaveBeenCalledWith(
        expect.objectContaining({ path: '.env' })
      );
    });

    it('resumes from an existing Commerce store_bound binding by ensuring the channel', async () => {
      const savedBinding = {
        appId: 'app-1',
        storeId: 'store-1',
        status: 'store_bound',
        source: 'tool_setup',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockFindBindingByAppId
        .mockReturnValueOnce(savedBinding)
        .mockReturnValue({ ...savedBinding, channelId: 'channel-1', status: 'channel_ready' });
      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        result: {
          structuredContent: {
            data: {
              channelId: 'channel-1',
              type: 'ONLINE',
              subType: 'airo.ai.builder',
              airo_app_id: 'app-1',
            },
          },
        },
      });

      const result = await runTool(
        provisionTool,
        {},
        { socketId: 'socket-1', metadata: { appId: 'app-1' } }
      );

      expect(mockExecuteAction).toHaveBeenCalledTimes(1);
      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            request: expect.objectContaining({
              params: expect.objectContaining({
                name: 'commerce_app_channel_ensure',
              }),
            }),
          }),
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          status: 'ready',
          storeId: 'store-1',
          channelId: 'channel-1',
          paymentSetupReady: true,
        })
      );
    });

    it('returns store choices when new-store setup returns a 409 conflict', async () => {
      const stores = [{ storeId: 'store-1', displayName: 'Existing Shop' }];
      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          result: {
            isError: true,
            structuredContent: {
              data: null,
              errors: [
                {
                  code: 'tool_error',
                  message: 'Tool execution failed.',
                  metadata: {
                    data: { errorType: 'RestDataSourceError', statusCode: 409 },
                  },
                },
              ],
            },
          },
        })
        .mockResolvedValueOnce({
          success: true,
          result: { structuredContent: { data: { stores } } },
        });

      const result = await runTool(
        provisionTool,
        { storeName: 'Existing Shop', storePreference: 'new' },
        { socketId: 'socket-1', metadata: { appId: 'app-1' } }
      );

      expect(result).toEqual(
        expect.objectContaining({
          status: 'needs_store_choice',
          conflict: 'store_creation_conflict',
          stores,
        })
      );
      expect(mockExecuteAction).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          params: expect.objectContaining({
            request: expect.objectContaining({
              params: { name: 'commerce_store_list', arguments: {} },
            }),
          }),
        })
      );
      expect(mockWorkspaceWrite).not.toHaveBeenCalled();
    });

    it('strips stale store identifiers but preserves business scope for new stores', async () => {
      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          result: {
            structuredContent: {
              data: { storeId: 'new-store-id', paymentsManualSetupRequired: false },
            },
          },
        })
        .mockResolvedValueOnce({
          success: true,
          result: {
            structuredContent: {
              data: {
                channelId: 'channel-1',
                type: 'ONLINE',
                subType: 'airo.ai.builder',
                airo_app_id: 'app-1',
              },
            },
          },
        });

      await runTool(
        provisionTool,
        {
          businessId: 'business-1',
          storeName: 'Paint Studio Annex',
          storePreference: 'new',
          storeId: 'stale-store-id',
          storeUrl: 'https://commerce.godaddy.com/stores/stale-store-id',
        },
        { socketId: 'socket-1', metadata: { appId: 'app-1' } }
      );

      expect(mockExecuteAction).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          params: expect.objectContaining({
            request: expect.objectContaining({
              params: {
                name: 'commerce_store_setup',
                arguments: {
                  businessId: 'business-1',
                  storeName: 'Paint Studio Annex',
                  storePreference: 'new',
                },
              },
            }),
          }),
        })
      );
    });
  });

  it('calls store read tools directly', async () => {
    mockExecuteAction
      .mockResolvedValueOnce({
        success: true,
        result: { structuredContent: { data: { stores: [] } } },
      })
      .mockResolvedValueOnce({
        success: true,
        result: { structuredContent: { data: { storeId: 'store-1', displayName: 'Shop' } } },
      })
      .mockResolvedValueOnce({
        success: true,
        result: { structuredContent: { data: { defaultChannelId: 'channel-1' } } },
      });

    await runTool(storeListTool, {});
    await runTool(storeGetTool, { storeId: 'store-1' });
    await runTool(storeChannelsGetTool, { storeId: 'store-1', defaultOnly: true });

    expect(mockExecuteAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        params: expect.objectContaining({
          request: expect.objectContaining({
            params: { name: 'commerce_store_list', arguments: {} },
          }),
        }),
      })
    );
    expect(mockExecuteAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        params: expect.objectContaining({
          request: expect.objectContaining({
            params: { name: 'commerce_store_get', arguments: { storeId: 'store-1' } },
          }),
        }),
      })
    );
    expect(mockExecuteAction).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        params: expect.objectContaining({
          request: expect.objectContaining({
            params: {
              name: 'commerce_store_channels_get',
              arguments: { storeId: 'store-1', defaultOnly: true },
            },
          }),
        }),
      })
    );
  });

  it('returns a string error when no websocket client action service exists', async () => {
    mockGetActionService.mockReturnValueOnce(undefined);

    const result = await runTool(storeListTool, {});

    expect(result).toMatch(/godaddy-payments__store_list error: .*client action service/);
  });
});
