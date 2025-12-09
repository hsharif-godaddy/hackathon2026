import type { ReactNode } from 'react'
import text from '@ux/text'
import Alert from '@ux/alert'

interface StreamingAlertMessageProps {
  title: string
  message: ReactNode
  type?: 'Critical' | 'Warning' | 'Info'
}

const emphasisMap = {
  Critical: 'critical',
  Warning: 'warning',
  Info: 'info'
} as const;

export default function StreamingAlertMessage({ title, message, type = 'Critical' }: StreamingAlertMessageProps) {
  return (
    <div className="mt-2">
      <Alert emphasis={emphasisMap[type]} title={title}>
        <text.p>{message}</text.p>
      </Alert>
    </div>
  )
}
