/**
 * Reamaze (Inbox) client — embeddable-specific operations.
 *
 * Shared account operations (dispatch, listAccounts, activateAccount) live in
 * `agents/src/skills/_shared/reamaze-client.ts`.
 */

import type { IClientActionService } from '../../../services/ClientActionService.js';
import { dispatch, type ReamazeResult } from '../../_shared/reamaze-client.js';

// ----------------------------------------------------------------------------
// Embeddable types
// ----------------------------------------------------------------------------

export interface Embeddable {
  id: number;
  title?: string;
  [key: string]: unknown;
}

/** Fields we support sending to PUT /embeddables/{id}. Snake-cased per controller. */
export interface UpdateEmbeddableInput {
  title?: string;
  shoutbox_position?: string;
  shoutbox_bg?: string;
  shoutbox_icon?: string;
  shoutbox_label?: string;
  styles?: {
    button_bg_color?: string;
    header_bg_color?: string;
    button_font_color?: string;
    header_font_color?: string;
  };
}

// ----------------------------------------------------------------------------
// Embeddable operations (brand-scoped)
// ----------------------------------------------------------------------------

export async function listEmbeddables(
  client: IClientActionService,
  appId: string,
  brandId: string,
): Promise<ReamazeResult<Embeddable[]>> {
  const result = await dispatch<{ embeddables?: Embeddable[] }>(client, {
    operation: 'list_embeddables',
    appId,
    brandId,
  });
  if (!result.success) return result;
  return { success: true, data: result.data.embeddables ?? [] };
}

export async function createEmbeddable(
  client: IClientActionService,
  appId: string,
  brandId: string,
  input: UpdateEmbeddableInput,
): Promise<ReamazeResult<Embeddable>> {
  const result = await dispatch<{ embeddable?: Embeddable } & Embeddable>(client, {
    operation: 'create_embeddable',
    appId,
    brandId,
    body: { embeddable: input },
  });
  if (!result.success) return result;
  const embeddable = result.data.embeddable ?? (result.data as Embeddable);
  if (typeof embeddable?.id !== 'number') {
    return { success: false, error: 'Reamaze response missing embeddable.id' };
  }
  return { success: true, data: embeddable };
}

export async function updateEmbeddable(
  client: IClientActionService,
  appId: string,
  brandId: string,
  embeddableId: number,
  input: UpdateEmbeddableInput,
): Promise<ReamazeResult<Embeddable>> {
  const result = await dispatch<{ embeddable?: Embeddable } & Embeddable>(client, {
    operation: 'update_embeddable',
    appId,
    brandId,
    embeddableId,
    body: { embeddable: input },
  });
  if (!result.success) return result;
  const embeddable = result.data.embeddable ?? (result.data as Embeddable);
  if (typeof embeddable?.id !== 'number') {
    return { success: false, error: 'Reamaze response missing embeddable.id' };
  }
  return { success: true, data: embeddable };
}
