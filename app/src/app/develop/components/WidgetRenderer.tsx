import { getWidgetComponent } from './widgets'

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
  const WidgetComponent = getWidgetComponent(widgetData.type)

  if (!WidgetComponent) {
    console.warn(`Widget type "${widgetData.type}" not found in registry`)
    return null
  }

  // Extract all props except 'type' to pass to the widget component
  const { type, ...widgetProps } = widgetData

  return (
    <div className={className}>
      <WidgetComponent {...(widgetProps as any)} />
    </div>
  )
}

