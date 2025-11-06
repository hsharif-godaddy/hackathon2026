/**
 * Simple key-value table component for displaying JSON objects
 * 
 * Displays a two-column table with keys on the left and values on the right.
 * Handles nested objects by stringifying them.
 * Alternating row colors for better readability.
 * 
 * @param data - Object to display as key-value pairs
 * @param title - Optional title to display above the table
 */
export default function KeyValueTable({ data, title }: { data: Record<string, any>; title?: string }) {
  if (!data || Object.keys(data).length === 0) {
    return null
  }

  return (
    <div>
      {title && <div className="text-xs font-bold mb-2">{title}</div>}
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(data).map(([key, value], index) => (
              <tr
                key={key}
                className={index % 2 === 0 ? 'bg-muted/50' : 'bg-background'}
              >
                <td className="px-3 py-2 font-medium text-foreground/70 border-r border-border w-1/3">
                  {key}
                </td>
                <td className="px-3 py-2 text-foreground font-mono text-xs break-all">
                  {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

