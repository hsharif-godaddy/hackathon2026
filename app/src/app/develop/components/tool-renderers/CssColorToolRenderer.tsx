'use client'

import { Palette } from 'lucide-react'
import { useEffect,useState } from 'react'

import ColorPaletteModal from '@/app/develop/components/tool-renderers/ColorPaletteModal'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import ColorPaletteWidget from '@/app/develop/components/widgets/ColorPaletteWidget'
import { useTranslations } from '@/hooks/useTranslations'

/**
 * Custom renderer for cssColor tool
 *
 * Shows "Color Scheme: {name} {mode}" on completion.
 * Auto-disappears 2 seconds after completion in generate-only mode.
 * Clickable to show larger format with labels and hex codes.
 *
 * @param props - Tool call information
 * @returns Rendered cssColor tool component
 */
export default function CssColorToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations();
  const [isVisible, setIsVisible] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Extract palette name and mode from result or input
  const isGenerateOnly = input?.generateOnly === true

  // Get palette name from result (now always included) or fallback to input
  let paletteName = t('builder_tools_css_color_scheme')
  if (result && typeof result === 'object') {
    const resultObj = result as any
    // Check for paletteName in result (applied mode)
    if (resultObj.paletteName) {
      paletteName = resultObj.paletteName
    }
    // Check for widget.name (generate mode)
    else if (resultObj.widget?.name) {
      paletteName = resultObj.widget.name
    }
    // Fallback to input
    else if (input?.paletteName) {
      paletteName = input.paletteName as string
    }
  } else if (input?.paletteName) {
    paletteName = input.paletteName as string
  }

  const mode = isGenerateOnly ? 'generated' : 'applied'

  // Auto-disappear effect for generate-only mode
  useEffect(() => {
    if (toolStatus === 'completed' && isGenerateOnly && result) {
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 2000)

      return () => clearTimeout(timer)
    }
  }, [toolStatus, isGenerateOnly, result])

  if (!isVisible) {
    return null
  }

  // Extract palette from result
  let palette: any = null

  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const resultObj = result as any

    if (resultObj.palette) {
      palette = resultObj.palette
    } else if (resultObj.widget?.palette) {
      palette = resultObj.widget.palette
    }
  }

  // Check if palette has the new complete format (background + foreground)
  // If not, it's from the old version - return null to hide component
  if (palette && (!palette.background || !palette.foreground)) {
    return null
  }

  const hasPalette = palette !== null
  const showDetailsTab = !isGenerateOnly && toolStatus === 'completed'

  // Get the full message output for details tab
  const fullMessage = result && typeof result === 'object' && (result as any).message
    ? (result as any).message
    : ''

  const displayName = toolStatus === 'completed'
    ? `${t('builder_tools_css_color_scheme')}: ${paletteName} ${mode}`
    : t('builder_tools_css_color_scheme')

  return (
    <div>
      <ToolHeader
        icon={<Palette className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasPalette}
        onOpenModal={() => setIsModalOpen(true)}
      />

      {/* Display palette widget beneath when applied (not generate-only) */}
      {toolStatus === 'completed' && !isGenerateOnly && hasPalette && (
        <div className="mt-2 mb-2">
          <ColorPaletteWidget
            name={paletteName}
            palette={palette}
          />
        </div>
      )}

      <ColorPaletteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={paletteName}
        palette={palette}
        showDetailsTab={showDetailsTab}
        detailsContent={fullMessage}
      />
    </div>
  )
}
