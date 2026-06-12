import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecuteAction, mockGetActionService } = vi.hoisted(() => ({
  mockExecuteAction: vi.fn(),
  mockGetActionService: vi.fn(),
}));

vi.mock('../../../../../server/agent-runtime.js', () => ({
  getActionService: mockGetActionService,
}));

const {
  setupTool,
  storeChannelEnsureTool,
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
    mockGetActionService.mockReset();
    mockGetActionService.mockReturnValue({
      executeAction: mockExecuteAction,
    });
  });

  it('exports payment setup and store/channel tools only', () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'setup',
      'store_channel_ensure',
      'store_channels_get',
      'store_get',
      'store_list',
    ]);
  });

  it('calls Commerce store setup through the GoDaddy Payments setup tool', async () => {
    const setupData = {
      storeId: 'store-1',
      paymentsManualSetupRequired: false,
    };
    mockExecuteAction.mockResolvedValueOnce({
      success: true,
      result: {
        structuredContent: {
          data: setupData,
          trace: [],
        },
      },
    });

    const result = await runTool(setupTool, {
      storeName: 'Paint Studio',
      storePreference: 'new',
    });

    expect(result).toEqual(setupData);
    expect(mockGetActionService).toHaveBeenCalledWith('socket-1');
    expect(mockExecuteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp_call',
        params: {
          serverId: 'commerce',
          request: expect.objectContaining({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
              name: 'commerce_store_setup',
              arguments: {
                storeName: 'Paint Studio',
                storePreference: 'new',
              },
            },
          }),
        },
      })
    );
  });

  it('ensures the Airo App Builder channel with trusted context fields', async () => {
    const channel = {
      channelId: 'channel-1',
      type: 'ONLINE',
      subType: 'airo.ai.builder',
      airo_app_id: 'app-1',
    };
    mockExecuteAction.mockResolvedValueOnce({
      success: true,
      result: { structuredContent: { data: channel } },
    });

    const result = await runTool(
      storeChannelEnsureTool,
      { storeId: 'store-1', channelName: 'Airo Shop' },
      { socketId: 'socket-1', metadata: { appId: 'app-1' } }
    );

    expect(result).toEqual(expect.objectContaining({
      ...channel,
      paymentSetupReady: true,
      NEXT_STEP: expect.stringContaining("skill({ action: 'install', skill: 'payment/godaddy-payments' })"),
      requiredNextActions: expect.arrayContaining([
        expect.stringContaining("skill({ action: 'install', skill: 'payment/godaddy-payments' })"),
      ]),
      forbiddenActions: expect.arrayContaining([
        expect.stringContaining('Do not create src/server/api/commerce/checkout/POST.ts manually.'),
        expect.stringContaining('Do not create src/server/api/commerce/order-status/GET.ts manually.'),
      ]),
    }));
    expect(mockExecuteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp_call',
        params: {
          serverId: 'commerce',
          request: expect.objectContaining({
            method: 'tools/call',
            params: {
              name: 'commerce_app_channel_ensure',
              arguments: {
                storeId: 'store-1',
                channelType: 'ONLINE',
                channelSubType: 'airo.ai.builder',
                channelName: 'Airo Shop',
                channelProviderId: '30373c02-3ab0-4f31-87e6-9c8e99ce83e2',
                externalApp: {
                  id: 'app-1',
                  name: 'Airo Shop',
                  source: 'airo-app-builder',
                },
              },
            },
          }),
        },
      })
    );
  });

  it('accepts deployed Commerce MCP ensure summaries that omit channel subtype', async () => {
    const channel = {
      storeId: 'store-1',
      source: 'airo-app-builder',
      externalAppId: 'app-1',
      externalChannelId: 'app-1',
      channelId: 'channel-1',
      channelType: 'ONLINE',
      channelName: 'Airo App Builder',
      action: 'created',
      created: true,
      linkedStore: true,
      updated: false,
      registrationStatus: 'ENABLED',
      isDefault: false,
    };
    mockExecuteAction.mockResolvedValueOnce({
      success: true,
      result: { structuredContent: { data: channel } },
    });

    const result = await runTool(
      storeChannelEnsureTool,
      { storeId: 'store-1' },
      { socketId: 'socket-1', metadata: { appId: 'app-1' } }
    );

    expect(result).toEqual(expect.objectContaining({
      ...channel,
      paymentSetupReady: true,
      NEXT_STEP: expect.stringContaining("skill({ action: 'install', skill: 'payment/godaddy-payments' })"),
    }));
  });

  it('rejects an invalid Airo channel response', async () => {
    mockExecuteAction.mockResolvedValueOnce({
      success: true,
      result: {
        structuredContent: {
          data: {
            channelId: 'default-channel',
            type: 'DEFAULT',
            subType: 'airo.ai.builder',
            airo_app_id: 'app-1',
          },
        },
      },
    });

    const result = await runTool(
      storeChannelEnsureTool,
      { storeId: 'store-1' },
      { socketId: 'socket-1', metadata: { appId: 'app-1' } }
    );

    expect(result).toMatch(/did not return a valid Airo App Builder channel/);
    expect(result).not.toMatch(/install', skill: 'payment\/godaddy-payments'/);
    expect(mockExecuteAction).toHaveBeenCalledTimes(1);
  });

  it('requires App Builder runtime app context before ensuring a channel', async () => {
    const result = await runTool(storeChannelEnsureTool, { storeId: 'store-1' });

    expect(result).toMatch(/App ID required/);
    expect(mockExecuteAction).not.toHaveBeenCalled();
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

    const result = await runTool(setupTool, {});

    expect(result).toMatch(/godaddy-payments__setup error: .*client action service/);
  });
});
