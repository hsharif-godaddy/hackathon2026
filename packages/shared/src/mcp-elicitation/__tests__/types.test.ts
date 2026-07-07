import { describe, expect, it } from 'vitest';

import type { ElicitationRequestedSchema } from '../index.js';
import {
  MCP_ELICITATION_CLIENT_CAPABILITIES,
} from '../index.js';

describe('mcp elicitation types', () => {
  it('exports the initialize capability payload for supported elicitation modes', () => {
    expect(MCP_ELICITATION_CLIENT_CAPABILITIES).toEqual({
      elicitation: {
        form: {},
        url: {},
      },
    });
  });

  it('accepts stable MCP enumNames labels for enum schemas', () => {
    const requestedSchema = {
      type: 'object',
      properties: {
        shippingSpeed: {
          type: 'string',
          enum: ['std', 'exp'],
          enumNames: ['Standard', 'Express'],
          default: 'std',
        },
        addOns: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['gift_wrap', 'signature'],
            enumNames: ['Gift wrap', 'Signature required'],
          },
          default: ['gift_wrap'],
        },
      },
      required: ['shippingSpeed'],
    } satisfies ElicitationRequestedSchema;

    expect(requestedSchema.properties.shippingSpeed.enumNames).toEqual([
      'Standard',
      'Express',
    ]);
    expect(requestedSchema.properties.addOns.items.enumNames).toEqual([
      'Gift wrap',
      'Signature required',
    ]);
  });
});
