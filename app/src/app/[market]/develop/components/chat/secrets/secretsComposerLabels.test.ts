/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'

import {
  secretsComposerSaveLabel,
  secretsComposerSendLabel,
} from '@/app/[market]/develop/components/chat/secrets/secretsComposerLabels'

describe('secretsComposerLabels', () => {
  const translate = (id: string) => id

  it('uses builder_common_save for save', function saveKey() {
    expect(secretsComposerSaveLabel(translate)).toBe('builder_common_save')
  })

  it('uses builder_common_submit for send', function sendKey() {
    expect(secretsComposerSendLabel(translate)).toBe('builder_common_submit')
  })
})
