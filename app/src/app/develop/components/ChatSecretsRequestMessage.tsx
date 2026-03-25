'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@ux/button'
import LockIcon from '@ux/icon/locked'
import DeleteIcon from '@ux/icon/x-thick'

import IconButton from '@/app/develop/components/IconButton'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useSecretOperations } from '@/hooks/useSecretOperations'
import { logger } from '@/lib/request-context'
import { useCurrentAppId } from '@/stores/useStreamingConversationStore'

/**
 * Individual secret definition from the agent
 */
export interface SecretDefinition {
  name: string
  description?: string
  required?: boolean
  isExisting?: boolean
  defaultValue?: string
}

/**
 * Generate a value for auto: prefixed defaultValues
 * Supported: auto:hex64, auto:hex32, auto:uuid
 */
function generateAutoValue(defaultValue: string | undefined): string {
  if (!defaultValue) return ''
  if (!defaultValue.startsWith('auto:')) return defaultValue

  const type = defaultValue.slice(5) // Remove 'auto:' prefix

  switch (type) {
    case 'hex64': {
      const array = new Uint8Array(32)
      crypto.getRandomValues(array)
      return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
    }
    case 'hex32': {
      const array = new Uint8Array(16)
      crypto.getRandomValues(array)
      return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
    }
    case 'uuid':
      return crypto.randomUUID()
    default:
      return defaultValue
  }
}

/**
 * Secrets request payload from agents service
 */
export interface SecretsRequestPayload {
  type: 'secrets_request'
  title: string
  description: string
  secrets: SecretDefinition[]
  mode: 'add' | 'update'
  allowMultiple?: boolean
  showSettingsLink?: boolean
  autoSubmit?: boolean
  existingSecretNames?: string[]
}

interface SecretFormRow {
  id: string
  name: string
  value: string
  description?: string
  required?: boolean
  isExisting?: boolean
  isUserAdded?: boolean
  valueTouched?: boolean
}

interface ChatSecretsRequestMessageProps {
  payload: SecretsRequestPayload
  conversationId?: string
  /** Whether the form is interactive (only true for latest assistant message) */
  isInteractive?: boolean
}

/**
 * Inline chat message for secrets management requests
 *
 * Displays when an agent action requires API keys or secrets.
 * Shows a form to add or update secrets and submits them via the secrets API.
 * When isInteractive is false (user has sent a subsequent message), shows a completed state.
 */
export default function ChatSecretsRequestMessage({
  payload,
  conversationId,
  isInteractive = true
}: ChatSecretsRequestMessageProps) {
  const currentAppId = useCurrentAppId()
  const { sendMessage } = useWebSocketContext()
  const secretOperations = useSecretOperations()

  const { title, description, secrets, mode, allowMultiple, showSettingsLink, autoSubmit, existingSecretNames = [] } = payload

  // Initialize form rows from payload (with auto-generated values for 'auto:' defaultValues)
  const initialRows: SecretFormRow[] = secrets.length > 0
    ? secrets.map((s, i) => ({
        id: `secret-${i}`,
        name: s.name,
        value: generateAutoValue(s.defaultValue),
        description: s.description,
        required: s.required,
        isExisting: s.isExisting,
        isUserAdded: false
      }))
    : [{
        id: 'secret-0',
        name: '',
        value: '',
        isUserAdded: true
      }]

  const [formRows, setFormRows] = useState<SecretFormRow[]>(initialRows)
  // In chat history (non-interactive), auto-submitted secrets already succeeded — show final state
  const [status, setStatus] = useState<'pending' | 'submitting' | 'success' | 'failed'>(
    !isInteractive && autoSubmit ? 'success' : 'pending'
  )
  const [error, setError] = useState<string | null>(null)
  const autoSubmitTriggered = useRef(false)

  // Auto-submit: when autoSubmit is true, save secrets without user interaction.
  // Deps include isInteractive (false during streaming, true once streaming ends)
  // and currentAppId (may be null initially). The ref guard prevents double-fires.
  useEffect(() => {
    if (!autoSubmit || !isInteractive || !currentAppId || autoSubmitTriggered.current) return
    autoSubmitTriggered.current = true

    const doAutoSubmit = async () => {
      const additions = initialRows
        .filter(r => r.name.trim() && r.value.trim())
        .map(r => ({ name: r.name.trim(), value: r.value.trim() }))

      if (additions.length === 0) {
        setStatus('failed')
        setError('No secrets to auto-generate — check defaultValue configuration')
        return
      }

      setStatus('submitting')

      try {
        await secretOperations.mutateAsync({
          appId: currentAppId,
          variant: 'preview',
          operations: { additions }
        })

        setStatus('success')

        const savedNames = additions.map(s => s.name).join(', ')
        const continueMessage = `Secrets added successfully: ${savedNames}. Please continue.`
        queueMicrotask(() => { void sendMessage({ content: continueMessage }) })
      } catch (err) {
        setStatus('failed')
        setError(err instanceof Error ? err.message : 'Failed to auto-save secrets')
      }
    }

    void doAutoSubmit()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omit stable-per-render values (autoSubmit, initialRows, secretOperations, sendMessage) to prevent re-triggering
  }, [isInteractive, currentAppId])

  /**
   * Sanitize secret name: uppercase, allowed characters only, max 128 chars
   */
  const sanitizeSecretName = (value: string): string => {
    let sanitized = value.toUpperCase()
    // Only allow: A-Z, 0-9, /, _, +, =, ., @, -
    sanitized = sanitized.replace(/[^A-Z0-9/_+=.@-]/g, '')
    // Enforce max length of 128
    return sanitized.slice(0, 128)
  }

  /**
   * Validate secret name format
   */
  const isValidSecretName = (name: string): boolean => {
    if (!name || name.length < 2 || name.length > 128) return false
    // Must start with A-Z or _
    if (!/^[A-Z_]/.test(name)) return false
    // Only allowed characters: A-Z, 0-9, /, _, +, =, ., @, -
    if (!/^[A-Z0-9/_+=.@-]+$/.test(name)) return false
    return true
  }

  /**
   * Check if secret name is unique (not in existing secrets or other form rows)
   */
  const isSecretNameUnique = (name: string, currentRowId: string): boolean => {
    // In add mode, check against existing secrets from the app
    if (mode === 'add') {
      const existsInApp = existingSecretNames.some(
        existing => existing.toUpperCase() === name.toUpperCase()
      )
      if (existsInApp) return false
    }

    // Check against other form rows (excluding current row)
    const existsInForm = formRows.some(
      row => row.id !== currentRowId && row.name.toUpperCase() === name.toUpperCase()
    )
    return !existsInForm
  }

  /**
   * Get validation error message for a name field
   */
  const getNameValidationError = (row: SecretFormRow): string | null => {
    const name = row.name.trim()

    // Skip validation for existing secrets (names are locked)
    if (row.isExisting || (row.required && !row.isUserAdded)) {
      return null
    }

    // Empty name
    if (!name) {
      return row.value.trim() ? 'Secret name is required' : null
    }

    // Length check
    if (name.length < 2) {
      return 'Min 2 characters'
    }

    // Must start with A-Z or _
    if (!/^[A-Z_]/.test(name)) {
      return 'Must start with A-Z or _'
    }

    // Invalid characters
    if (!/^[A-Z0-9/_+=.@-]+$/.test(name)) {
      return 'Invalid characters'
    }

    // Already exists
    if (!isSecretNameUnique(name, row.id)) {
      if (mode === 'add' && existingSecretNames.some(e => e.toUpperCase() === name.toUpperCase())) {
        return 'Secret already exists in app'
      }
      return 'Duplicate name'
    }

    return null
  }

  /**
   * Check if value is valid (non-empty)
   */
  const isValueValid = (value: string): boolean => {
    return value.trim() !== ''
  }

  /**
   * Get validation error message for a value field
   * Only shows error after user has interacted with the field (touched)
   */
  const getValueValidationError = (row: SecretFormRow): string | null => {
    // Don't show error until user has touched the value field
    if (!row.valueTouched) {
      return null
    }

    const name = row.name.trim()
    const value = row.value.trim()

    // Only show value error if name is valid
    if (!name || !isValidSecretName(name) || !isSecretNameUnique(name, row.id)) {
      return null
    }

    if (!value) {
      return 'Secret value is required'
    }

    return null
  }

  /**
   * Check if name field is locked (existing secret or required pre-filled)
   */
  const isNameFieldLocked = (row: SecretFormRow): boolean => {
    return row.isExisting || (row.required && !row.isUserAdded)
  }

  /**
   * Check if name field should be disabled
   */
  const isNameFieldDisabled = (row: SecretFormRow): boolean => {
    return isFormDisabled || isNameFieldLocked(row)
  }

  /**
   * Get text color for name field based on state
   */
  const getNameFieldColor = (row: SecretFormRow): string => {
    if (isNameFieldDisabled(row)) return 'gray'
    if (getNameValidationError(row)) return 'red'
    return 'black'
  }

  const handleNameChange = (id: string, name: string) => {
    const sanitized = sanitizeSecretName(name)
    setFormRows(rows => rows.map(row =>
      row.id === id ? { ...row, name: sanitized } : row
    ))
  }

  const handleValueChange = (id: string, value: string) => {
    setFormRows(rows => rows.map(row =>
      row.id === id ? { ...row, value, valueTouched: true } : row
    ))
  }

  const handleValueBlur = (id: string) => {
    setFormRows(rows => rows.map(row =>
      row.id === id ? { ...row, valueTouched: true } : row
    ))
  }

  const handleRemoveRow = (id: string) => {
    setFormRows(rows => rows.filter(row => row.id !== id))
  }

  const handleAddRow = () => {
    setFormRows(rows => [
      ...rows,
      {
        id: `secret-${Date.now()}`,
        name: '',
        value: '',
        isUserAdded: true
      }
    ])
  }

  const isFormValid = () => {
    // Check that all required secrets have valid names and values
    const requiredSecrets = formRows.filter(r => r.required)
    const requiredValid = requiredSecrets.every(r => {
      const name = r.name.trim()
      const value = r.value.trim()
      // Required secrets with locked names only need value
      if (r.isExisting || !r.isUserAdded) {
        return value !== ''
      }
      return isValidSecretName(name) && isSecretNameUnique(name, r.id) && value !== ''
    })

    // Check that ALL rows with any content are fully valid (no partial/invalid rows allowed)
    const allRowsValid = formRows.every(r => {
      const name = r.name.trim()
      const value = r.value.trim()

      // Empty row is okay (will be filtered out on submit)
      if (!name && !value) return true

      // For existing/locked names, just check value is present
      if (r.isExisting || (r.required && !r.isUserAdded)) {
        return value !== ''
      }

      // Row has content - must be fully valid
      return isValidSecretName(name) && isSecretNameUnique(name, r.id) && value !== ''
    })

    // Check that at least one secret has valid name and value
    const hasAtLeastOneValid = formRows.some(r => {
      const name = r.name.trim()
      const value = r.value.trim()
      if (!name || !value) return false
      // For existing/locked names, just check value is present
      if (r.isExisting || (r.required && !r.isUserAdded)) {
        return true
      }
      return isValidSecretName(name) && isSecretNameUnique(name, r.id)
    })

    return requiredValid && allRowsValid && hasAtLeastOneValid
  }

  const handleSubmit = async () => {
    if (!currentAppId) {
      setError('No app selected')
      setStatus('failed')
      return
    }

    // Mark all fields as touched to show validation errors
    setFormRows(rows => rows.map(row => ({ ...row, valueTouched: true })))

    if (!isFormValid()) {
      setError('Please fill in all required fields')
      return
    }

    setStatus('submitting')
    setError(null)

    try {
      // Separate additions vs updates based on isExisting flag, with full validation
      const additions = formRows
        .filter(r => {
          if (r.isExisting) return false
          const name = r.name.trim()
          const value = r.value.trim()
          if (!name || !value) return false
          // For locked required secrets, skip name format validation
          if (r.required && !r.isUserAdded) return true
          return isValidSecretName(name) && isSecretNameUnique(name, r.id) && isValueValid(value)
        })
        .map(r => ({ name: r.name.trim(), value: r.value.trim() }))

      const updates = formRows
        .filter(r => r.isExisting && r.name.trim() && isValueValid(r.value))
        .map(r => ({ name: r.name.trim(), value: r.value.trim() }))

      logger.info('secrets.chat_request.submitting', {
        conversationId,
        appId: currentAppId,
        additionsCount: additions.length,
        updatesCount: updates.length
      })

      await secretOperations.mutateAsync({
        appId: currentAppId,
        variant: 'preview',
        operations: {
          additions: additions.length > 0 ? additions : undefined,
          updates: updates.length > 0 ? updates : undefined
        }
      })

      logger.info('secrets.chat_request.success', {
        conversationId,
        appId: currentAppId
      })

      setStatus('success')

      // Build a message summarizing what was saved
      const savedNames = [...additions, ...updates].map(s => s.name).join(', ')
      const actionWord = mode === 'update' ? 'updated' : 'added'

      // Notify agent in a microtask to avoid background-tab rAF throttling.
      const continueMessage = `Secrets ${actionWord} successfully: ${savedNames}. Please continue.`
      queueMicrotask(() => { void sendMessage({ content: continueMessage }) })

    } catch (err) {
      logger.error('secrets.chat_request.error', {
        conversationId,
        appId: currentAppId,
        error: err instanceof Error ? err.message : String(err)
      })

      setStatus('failed')
      setError(err instanceof Error ? err.message : 'Failed to save secrets')
    }
  }

  const handleCancel = () => {
    sendMessage({ content: 'I cancelled adding secrets.' })
  }

  // Determine if we can remove a row (can't remove required secrets or if only one row left)
  const canRemoveRow = (row: SecretFormRow) => {
    if (row.required) return false
    if (formRows.length <= 1) return false
    return true
  }

  // Determine if form should be interactive (only when it's in the latest assistant message and status is pending)
  const isFormDisabled = !isInteractive || status !== 'pending'

  // Compact auto-submit UI — no form, just a status indicator
  if (autoSubmit) {
    return (
      <div className="max-w-2xl mx-auto my-2">
        <div className="rounded-lg border p-3 border-intents-ux-info-borderColor/50 bg-intents-ux-info-backgroundColor/50">
          <div className="flex items-center gap-2">
            <LockIcon className="w-4 h-4 text-foreground/60 flex-shrink-0" />
            {status === 'submitting' && (
              <span className="text-sm text-typography-mediumEmphasis">
                Auto-generating secrets...
              </span>
            )}
            {status === 'success' && (
              <span className="text-sm text-intents-ux-success-textColor">
                Secrets configured automatically
              </span>
            )}
            {status === 'failed' && (
              <span className="text-sm text-intents-ux-feedbackHighContrastCritical-feedbackColor">
                Failed to auto-generate secrets{error ? `: ${error}` : ''}
              </span>
            )}
            {status === 'pending' && (
              <span className="text-sm text-typography-mediumEmphasis">
                Preparing secrets...
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto my-2">
      <div className={`rounded-lg border p-3 ${
        isInteractive
          ? 'border-intents-ux-info-borderColor bg-intents-ux-info-backgroundColor'
          : 'border-intents-ux-info-borderColor/50 bg-intents-ux-info-backgroundColor/50 opacity-60'
      }`}>
        {/* Header */}
        <div className="mb-3">
          <div>
            <h3 className="text-base font-semibold text-typography-highEmphasis mb-0.5">
              {title}
            </h3>
            <p className="text-sm text-typography-mediumEmphasis">
              {description}
            </p>
          </div>
        </div>

        {/* Secret Rows - always visible, disabled during non-pending states */}
        <div className="space-y-4 mt-3">
          {formRows.map((row) => (
            <div key={row.id} className="space-y-2 p-2 bg-white/50 rounded border border-intents-ux-info-borderColor/30">
              {/* Row Header with Remove Button */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-typography-lowEmphasis font-medium">
                  {row.isExisting ? 'Update Secret' : 'New Secret'}
                  {row.required && <span className="text-intents-ux-error-textColor ml-1">*</span>}
                </span>
                {canRemoveRow(row) && (
                  <IconButton
                    icon={<DeleteIcon className="w-3.5 h-3.5" />}
                    onClick={() => handleRemoveRow(row.id)}
                    label="Remove"
                    disabled={isFormDisabled}
                    className={`text-typography-lowEmphasis ${!isFormDisabled ? 'hover:text-intents-ux-error-textColor' : 'opacity-50 cursor-not-allowed'}`}
                  />
                )}
              </div>

              {/* Name Input */}
              <div className="relative">
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => handleNameChange(row.id, e.target.value)}
                  placeholder="SECRET_NAME"
                  disabled={isNameFieldDisabled(row)}
                  style={{
                    backgroundColor: isNameFieldDisabled(row) ? '#f3f4f6' : 'white',
                    color: getNameFieldColor(row),
                    borderColor: getNameValidationError(row) && isInteractive ? 'red' : ''
                  }}
                  className={`w-full px-2 py-1.5 text-sm border rounded font-mono
                    ${isNameFieldDisabled(row) ? 'cursor-not-allowed' : 'text-typography-highEmphasis'}
                    ${getNameValidationError(row) && isInteractive ? 'border-intents-ux-error-borderColor' : 'border-intents-ux-info-borderColor'}
                    focus:outline-none focus:ring-1 focus:ring-intents-ux-info-borderColor`}
                />
                {row.isExisting && (
                  <LockIcon className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-typography-lowEmphasis" />
                )}
              </div>
              {/* Name Validation Error - only show when interactive */}
              {isInteractive && getNameValidationError(row) && (
                <p className="text-xs -mt-1 text-intents-ux-feedbackHighContrastCritical-feedbackColor">
                  {getNameValidationError(row)}
                </p>
              )}
              {/* Name Format Hint */}
              {row.isUserAdded && !row.name && !row.value && (
                <p className="text-xs text-typography-lowEmphasis -mt-1">
                  Allowed: A-Z, 0-9, / _ + = . @ - (2-128 chars, start with A-Z or _)
                </p>
              )}

              {/* Value Input */}
              <input
                type="password"
                value={row.value}
                onChange={(e) => handleValueChange(row.id, e.target.value)}
                onBlur={() => handleValueBlur(row.id)}
                placeholder={row.isExisting ? 'Enter new value' : 'Enter value'}
                disabled={isFormDisabled}
                style={{
                  backgroundColor: isFormDisabled ? '#f3f4f6' : 'white',
                  color: isFormDisabled ? 'gray' : 'black'
                }}
                className={`w-full px-2 py-1.5 text-sm border rounded font-mono
                  ${isFormDisabled ? 'cursor-not-allowed' : 'text-typography-highEmphasis'}
                  ${getValueValidationError(row) && isInteractive ? 'border-intents-ux-error-borderColor' : 'border-intents-ux-info-borderColor'}
                  focus:outline-none focus:ring-1 focus:ring-intents-ux-info-borderColor`}
              />
              {/* Value Validation Error - only show when interactive */}
              {isInteractive && getValueValidationError(row) && (
                <p className="text-xs -mt-1 text-intents-ux-feedbackHighContrastCritical-feedbackColor">
                  {getValueValidationError(row)}
                </p>
              )}

              {/* Description / Help Text */}
              {row.description && (
                <p className="text-xs text-typography-lowEmphasis">
                  {row.description}
                </p>
              )}
            </div>
          ))}
            </div>

        {/* Add Another Button */}
        {allowMultiple && (
          <div className="mt-2">
            <Button
              design="tertiary"
              size="sm"
              onClick={handleAddRow}
              disabled={isFormDisabled}
            >
              + Add Another Secret
            </Button>
          </div>
        )}

        {/* Settings Link */}
        {showSettingsLink && (
          <p className="mt-3 text-xs text-typography-lowEmphasis">
            Or use <span className="font-medium">Secrets</span> in settings for full management.
          </p>
        )}

        {/* Error Message - only show when interactive and pending */}
        {isInteractive && status === 'pending' && error && (
          <p className="mt-2 text-xs text-intents-ux-feedbackHighContrastCritical-feedbackColor">
            {error}
          </p>
        )}

        {/* Action Buttons / Status Messages */}
        <div className="mt-3 flex items-center gap-2">
          {status === 'pending' && (
            <>
              <Button
                design="secondary"
                size="sm"
                onClick={handleCancel}
                disabled={!isInteractive}
              >
                Cancel
              </Button>
              <Button
                design="primary"
                size="sm"
                onClick={handleSubmit}
                disabled={!isInteractive || !isFormValid()}
              >
                {mode === 'update'
                  ? 'Update Secret'
                  : formRows.length === 1 ? 'Save Secret' : 'Save Secrets'}
              </Button>
            </>
          )}

          {status === 'submitting' && (
            <div className="text-sm text-typography-mediumEmphasis">
              Saving secrets...
            </div>
          )}

          {status === 'success' && (
            <div className="text-sm text-intents-ux-success-textColor font-medium">
              {mode === 'update' ? 'Secret updated successfully' : 'Secrets saved successfully'}
            </div>
          )}

          {status === 'failed' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-intents-ux-feedbackHighContrastCritical-feedbackColor font-medium">Failed</span>
              <Button
                design="secondary"
                size="sm"
                onClick={() => setStatus('pending')}
              >
                Try Again
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
