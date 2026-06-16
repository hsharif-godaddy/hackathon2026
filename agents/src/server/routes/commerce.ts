/**
 * App Commerce Binding Routes
 *
 * GET    /apps/:id/commerce/binding  -> read durable Commerce binding
 * PATCH  /apps/:id/commerce/binding  -> set or switch the binding
 * PUT    /apps/:id/commerce/binding  -> same as PATCH
 * DELETE /apps/:id/commerce/binding  -> clear the binding
 */

import { Router, Request, Response, IRouter } from 'express';
import { z, ZodError } from 'zod';

import { AppCommerceBindingRepository } from '../../database/repositories/AppCommerceBindingRepository.js';
import type { AppCommerceBinding, AppCommerceBindingStatus } from '../../database/schema.js';
import { Logger } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';

const router: IRouter = Router();
const logger = Logger.create({ component: 'commerce-routes' });

const bindingPatchSchema = z
  .object({
    businessId: z.string().trim().min(1).optional(),
    businessName: z.string().trim().min(1).optional(),
    storeId: z.string().trim().min(1).optional(),
    storeName: z.string().trim().min(1).optional(),
    storeUrl: z.string().trim().url().optional(),
    channelId: z.string().trim().min(1).optional(),
    channelName: z.string().trim().min(1).optional(),
    defaultLocationId: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((input) => Boolean(input.businessId || input.storeId || input.channelId), {
    message: 'At least one of businessId, storeId, or channelId is required.',
  });

const clearBindingSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

type BindingPatch = z.infer<typeof bindingPatchSchema>;
type SerializedBinding = Omit<AppCommerceBinding, 'lastVerifiedAt' | 'createdAt' | 'updatedAt'> & {
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

class InvalidCommerceBindingRequestError extends Error {}

function repository(): AppCommerceBindingRepository {
  return new AppCommerceBindingRepository();
}

function serializeBinding(binding: AppCommerceBinding): SerializedBinding {
  return {
    ...binding,
    lastVerifiedAt: binding.lastVerifiedAt?.toISOString() ?? null,
    createdAt: binding.createdAt.toISOString(),
    updatedAt: binding.updatedAt.toISOString(),
  };
}

function validationErrorResponse(res: Response, error: ZodError): void {
  res.status(400).json({
    error: 'Invalid Commerce binding request',
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

function storeChanged(input: BindingPatch, previous: AppCommerceBinding | null): boolean {
  return (
    typeof input.storeId === 'string'
    && typeof previous?.storeId === 'string'
    && previous.storeId !== input.storeId
  );
}

function determineStatus(input: BindingPatch, previous: AppCommerceBinding | null): AppCommerceBindingStatus {
  if (input.channelId) {
    return 'channel_ready';
  }

  if (input.storeId) {
    return !storeChanged(input, previous) && previous?.channelId ? 'channel_ready' : 'store_bound';
  }

  return 'business_bound';
}

function upsertBinding(appId: string, input: BindingPatch): AppCommerceBinding {
  const repo = repository();
  const previous = repo.findByAppId(appId);
  const didStoreChange = storeChanged(input, previous);
  const clearToBusinessOnly = Boolean(input.businessId && !input.storeId);

  if (input.channelId && !input.storeId && !previous?.storeId) {
    throw new InvalidCommerceBindingRequestError('channelId requires an existing or supplied storeId');
  }

  return repo.upsert({
    appId,
    businessId: input.businessId,
    businessName: input.businessName,
    storeId: input.storeId ?? (clearToBusinessOnly ? null : undefined),
    storeName: input.storeName ?? (clearToBusinessOnly ? null : undefined),
    storeUrl: input.storeUrl ?? (clearToBusinessOnly ? null : undefined),
    channelId: input.channelId ?? (didStoreChange || clearToBusinessOnly ? null : undefined),
    channelName: input.channelName ?? (didStoreChange || clearToBusinessOnly ? null : undefined),
    defaultLocationId: input.defaultLocationId ?? (clearToBusinessOnly ? null : undefined),
    status: determineStatus(input, previous),
    source: 'user_selected',
    lastVerifiedAt: input.channelId ? new Date() : null,
    verificationError: null,
    eventType: input.channelId ? 'ensured_channel' : input.storeId ? 'selected_store' : 'selected_business',
    actorType: 'user',
    reason: input.reason ?? 'Commerce binding updated from management API',
    metadata: {
      previousBusinessId: previous?.businessId ?? null,
      previousStoreId: previous?.storeId ?? null,
      previousChannelId: previous?.channelId ?? null,
    },
  });
}

router.get('/apps/:id/commerce/binding', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id!;

  try {
    const binding = repository().findByAppId(appId);
    res.json(binding ? { configured: true, binding: serializeBinding(binding) } : { configured: false, binding: null });
  } catch (error) {
    logger.error('commerce.binding.get.failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to read Commerce binding' });
  }
});

function handleBindingUpdate(req: Request, res: Response): void {
  const appId = req.params.id!;

  try {
    const parsed = bindingPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      validationErrorResponse(res, parsed.error);
      return;
    }

    const binding = upsertBinding(appId, parsed.data);
    res.json({
      configured: true,
      binding: serializeBinding(binding),
      commerceSetupReady: binding.status === 'channel_ready',
      requiredNextAction:
        binding.status === 'channel_ready'
          ? null
          : 'Ensure the Airo App Builder Commerce channel for the selected store before Commerce mutations.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof InvalidCommerceBindingRequestError) {
      res.status(400).json({ error: message });
      return;
    }

    logger.error('commerce.binding.update.failed', { appId, error: message });
    res.status(500).json({ error: 'Failed to update Commerce binding' });
  }
}

router.patch('/apps/:id/commerce/binding', validateAppOwnership, handleBindingUpdate);
router.put('/apps/:id/commerce/binding', validateAppOwnership, handleBindingUpdate);

router.delete('/apps/:id/commerce/binding', validateAppOwnership, (req: Request, res: Response) => {
  const appId = req.params.id!;

  try {
    const parsed = clearBindingSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      validationErrorResponse(res, parsed.error);
      return;
    }

    const cleared = repository().clear(appId, 'user', parsed.data.reason ?? 'Commerce binding cleared from management API');
    res.json({ configured: false, binding: null, cleared });
  } catch (error) {
    logger.error('commerce.binding.clear.failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to clear Commerce binding' });
  }
});

export default router;
