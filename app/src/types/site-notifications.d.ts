declare module '@site/notifications' {
  import type { FunctionComponent } from 'react'

  interface NotificationsProps {
    id: string
    appKey: string
    onClick?: () => void
    onClose?: () => void
    onAction?: () => void
    onActionComplete?: () => void
    onError?: (e: Error) => void
    disableRefreshOnAction?: boolean
  }

  const Notifications: FunctionComponent<NotificationsProps>
  export default Notifications
}
