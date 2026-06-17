import { Router, Request, Response } from 'express';
import { log } from '../../logging/index.js';
import { createForWorkspace } from '../../workspace/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { patchFieldValue, setSectionValue, validateFieldValue } from '../../services/compliance-field-patch.js';

const router: Router = Router();

// Tenant isolation: every /:id route operates on that app's workspace, so the
// caller's JWT siteId must match the app id. Express routers are independent
// middleware stacks — appsRouter's guard does NOT run for this router — so it
// must be applied here, before the handlers. Regex avoids matching static
// subpaths. (agents/CLAUDE.md "Tenant Isolation".)
router.use('/:id([a-z0-9]{10})', validateAppOwnership);

const PAGE_PATH_BY_DOC_TYPE: Record<string, string> = {
  'privacy-policy': 'src/pages/privacy.tsx',
  'terms-of-use': 'src/pages/terms.tsx',
};

interface FieldPatchBody {
  documentType?: string;
  fieldKey?: string;
  newValue?: string;
}

interface SectionToggleBody {
  documentType?: string;
  sectionKey?: string;
  value?: boolean;
}

/**
 * Update a single editable field value inside the generated compliance page.
 * Deterministic, no LLM: every `<span data-field="KEY" data-editable="true">`
 * occurrence (including ones in hidden section branches) is replaced.
 */
router.post('/:id/compliance/field', async (req: Request, res: Response) => {
  const { id: appId } = req.params;
  if (!appId) {
    return res.status(400).json({ error: 'App ID is required' });
  }
  const { documentType, fieldKey, newValue } = (req.body ?? {}) as FieldPatchBody;
  const contextLogger = log.forApp(appId);

  const pagePath = documentType ? PAGE_PATH_BY_DOC_TYPE[documentType] : undefined;
  if (!pagePath || typeof fieldKey !== 'string' || !fieldKey || typeof newValue !== 'string') {
    return res.status(400).json({ error: 'Invalid documentType, fieldKey, or newValue' });
  }

  const validation = validateFieldValue(fieldKey, newValue);
  if (!validation.ok) {
    return res.status(400).json({ error: 'Invalid field value', reason: validation.reason });
  }

  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) {
    return res.status(404).json({ error: 'App not found' });
  }

  try {
    const file = await workspace.files.view({ path: pagePath });
    const { content, replaced } = patchFieldValue(file.content, fieldKey, newValue);
    if (replaced === 0) {
      contextLogger.warn('compliance.field.patch.not-found', { appId, documentType, fieldKey });
      return res.status(409).json({ error: 'Field not found in document' });
    }
    await workspace.files.write({ path: pagePath, content });
    contextLogger.info('compliance.field.patch.success', { appId, documentType, fieldKey, replaced });
    return res.json({ success: true, fieldKey, replaced });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    contextLogger.error('compliance.field.patch.failure', { appId, documentType, fieldKey, error: message });
    return res.status(500).json({ error: 'Failed to update field', details: message });
  }
});

/**
 * Toggle a boolean section, flipping which branch is visible. Deterministic, no
 * LLM: the matching `data-section-when` branch is shown and the inverse hidden
 * via `data-hidden`/`display:none`. Handles inline single-branch sections.
 */
router.post('/:id/compliance/section', async (req: Request, res: Response) => {
  const { id: appId } = req.params;
  if (!appId) {
    return res.status(400).json({ error: 'App ID is required' });
  }
  const { documentType, sectionKey, value } = (req.body ?? {}) as SectionToggleBody;
  const contextLogger = log.forApp(appId);

  const pagePath = documentType ? PAGE_PATH_BY_DOC_TYPE[documentType] : undefined;
  if (!pagePath || typeof sectionKey !== 'string' || !sectionKey || typeof value !== 'boolean') {
    return res.status(400).json({ error: 'Invalid documentType, sectionKey, or value' });
  }

  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) {
    return res.status(404).json({ error: 'App not found' });
  }

  try {
    const file = await workspace.files.view({ path: pagePath });
    const { content, matched } = setSectionValue(file.content, sectionKey, value);
    if (matched === 0) {
      contextLogger.warn('compliance.section.toggle.not-found', { appId, documentType, sectionKey });
      return res.status(409).json({ error: 'Section not found in document' });
    }
    await workspace.files.write({ path: pagePath, content });
    contextLogger.info('compliance.section.toggle.success', { appId, documentType, sectionKey, value, matched });
    return res.json({ success: true, sectionKey, value });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    contextLogger.error('compliance.section.toggle.failure', { appId, documentType, sectionKey, error: message });
    return res.status(500).json({ error: 'Failed to toggle section', details: message });
  }
});

export default router;
