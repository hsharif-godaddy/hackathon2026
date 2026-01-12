import type { ReactNode } from 'react'
import Alert from '@ux/alert'
import text from '@ux/text'

interface StreamingAlertMessageProps {
  title: string
  message: ReactNode
  type?: 'Critical' | 'Warning' | 'Info'
  actions?: ReactNode
}

const emphasisMap = {
  Critical: 'critical',
  Warning: 'warning',
  Info: 'info'
} as const;

export default function StreamingAlertMessage({ title, message, type = 'Critical', actions }: StreamingAlertMessageProps) {
  return (
    <div className="mt-2">
      <Alert emphasis={emphasisMap[type]} title={title} actions={actions}>
        <text.p>{message}</text.p>
      </Alert>
    </div>
  )
}
