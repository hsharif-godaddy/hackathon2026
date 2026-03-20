import type { ReactNode } from 'react'
import Alert from '@ux/alert'
import text from '@ux/text'

interface StreamingAlertMessageProps {
  title: string
  message: ReactNode
  type?: 'Critical' | 'Warning' | 'Info'
  actions?: ReactNode
  onClose?: () => void
}

const emphasisMap = {
  Critical: 'critical',
  Warning: 'warning',
  Info: 'info'
} as const;

export default function StreamingAlertMessage({ title, message, type = 'Critical', actions, onClose }: StreamingAlertMessageProps) {
  return (
    <div className="mt-2">
      <Alert emphasis={emphasisMap[type]} title={title} actions={actions} onClose={onClose}>
        <text.p>{message}</text.p>
      </Alert>
    </div>
  )
}
