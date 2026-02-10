'use client'

import Box from '@ux/box'
import Modal from '@ux/modal'
import Spinner from '@ux/spinner'

interface PaywallLoadingModalProps {
  onClose: () => void
}

/**
 * Loading modal shown while CDS library loads
 */
export function PaywallLoadingModal({ onClose }: PaywallLoadingModalProps) {
  return (
    <Modal
      title=""
      onClose={onClose}
      centered
    >
      <Box className="flex items-center justify-center py-8 min-h-48 min-w-48">
        <Spinner size="lg" />
      </Box>
    </Modal>
  )
}
