import { describe, expect, it } from 'vitest';

import {
  AAB_CHECKOUT_SOURCE_APP,
  buildBuyNowCheckoutInput,
  buildCartCheckoutInput,
  buildNonCatalogCheckoutInput,
  type CheckoutSessionOverrides,
} from '../../templates/lib/commerce/checkout-subgraph';

const baseCheckoutInput = {
  storeId: '11111111-1111-4111-8111-111111111111',
  channelId: '22222222-2222-4222-8222-222222222222',
  returnUrl: 'https://example.com/checkout',
  successUrl: 'https://example.com/success',
};

describe('GoDaddy Payments checkout templates', () => {
  it('uses the AAB checkout source expected by checkout-api transaction processing', () => {
    expect(AAB_CHECKOUT_SOURCE_APP).toBe('airo.ai.builder');
  });

  it('sets the AAB channel and source app on buy-now checkout sessions', () => {
    expect(
      buildBuyNowCheckoutInput({
        ...baseCheckoutInput,
        skuId: 'sku-1',
      })
    ).toMatchObject({
      channelId: baseCheckoutInput.channelId,
      sourceApp: AAB_CHECKOUT_SOURCE_APP,
    });
  });

  it('sets the AAB channel and source app on cart checkout sessions', () => {
    expect(
      buildCartCheckoutInput({
        ...baseCheckoutInput,
        draftOrderId: 'order-1',
      })
    ).toMatchObject({
      channelId: baseCheckoutInput.channelId,
      sourceApp: AAB_CHECKOUT_SOURCE_APP,
    });
  });

  it('sets the AAB channel and source app on non-catalog checkout sessions', () => {
    expect(
      buildNonCatalogCheckoutInput({
        ...baseCheckoutInput,
        lineItemData: {
          name: 'Deposit',
          priceData: {
            unitAmount: 2500,
            currencyCode: 'USD',
          },
        },
      })
    ).toMatchObject({
      channelId: baseCheckoutInput.channelId,
      sourceApp: AAB_CHECKOUT_SOURCE_APP,
    });
  });

  it('preserves the AAB source app when checkout overrides are applied', () => {
    expect(
      buildBuyNowCheckoutInput(
        {
          ...baseCheckoutInput,
          skuId: 'sku-1',
        },
        {
          enableTips: true,
          sourceApp: 'not.aab',
        } as unknown as CheckoutSessionOverrides
      )
    ).toMatchObject({
      enableTips: true,
      sourceApp: AAB_CHECKOUT_SOURCE_APP,
    });
  });
});
