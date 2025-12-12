import { getWidgetComponent } from './widgets'
import { logger } from '@/lib/request-context'

interface WidgetRendererProps {
  widgetData: {
    type: string
    [key: string]: any
  }
  className?: string
}

/**
 * Renders a widget based on the provided widget data
 *
 * Dynamically loads and renders the appropriate widget component based on
 * the widget type specified in the widget data.
 *
 * @param widgetData - The widget data containing type and widget props
 * @param className - Optional CSS classes to apply to the widget container
 * @returns The rendered widget component or null if not found
 */
export default function WidgetRenderer({ widgetData, className = '' }: WidgetRendererProps) {
  logger.info('widget-renderer.render', { widgetType: widgetData.type })

  const WidgetComponent = getWidgetComponent(widgetData.type)

  if (!WidgetComponent) {
    logger.warn('widget-renderer.not-found', { widgetType: widgetData.type })
    return null
  }

  // Extract all props except 'type' to pass to the widget component
  const { type: _type, ...widgetProps } = widgetData /* eslint-disable-line @typescript-eslint/no-unused-vars */

  logger.info('widget-renderer.component-found', {
    widgetType: widgetData.type,
    hasProps: Object.keys(widgetProps).length > 0
  })

  return (
    <div className={className}>
      <WidgetComponent {...(widgetProps as any)} />
    </div>
  )
}

