import { text } from '@ux/text'

export function DesignFileUploadError({ error }: { error: string }) {
  return (
    <text.p size={-2} emphasis="critical" role="alert">
      {error}
    </text.p>
  )
}
