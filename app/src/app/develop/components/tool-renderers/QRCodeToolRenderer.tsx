'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Download,QrCode } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'

interface QRCodeResult {
  success: boolean
  targetUrl: string
  targetPage: string
  size: number
  base64: string
}

/**
 * Custom renderer for qrCode tool
 *
 * Displays the generated QR code inline with options to:
 * - View larger version in modal
 * - Download the QR code
 * - See the target URL
 */
export default function QRCodeToolRenderer({
  toolName: _toolName,
  toolStatus,
  input: _input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Parse result
  let parsedResult: QRCodeResult | null = null

  if (result) {
    try {
      if (typeof result === 'string') {
        parsedResult = JSON.parse(result) as QRCodeResult
      } else if (typeof result === 'object' && result !== null) {
        parsedResult = result as unknown as QRCodeResult
      }
    } catch (e) {
      logger.error('tool.qr_code.parse.failed', {
        error: e instanceof Error ? e.message : String(e),
        resultLength: typeof result === 'string' ? result.length : 0
      })
    }
  }

  const hasQRCode = Boolean(parsedResult?.success && parsedResult?.base64)

  // Format page name: Home for /, capitalize first letter for others
  const formatPageName = (path: string) => {
    if (path === '/') return t('builder_qr_code_page_home')
    const cleanPath = path.replace(/^\//, '').replace(/\//g, ' / ')
    return cleanPath.split(' ').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ')
  }

  const pageName = parsedResult?.targetPage ? formatPageName(parsedResult.targetPage) : t('builder_qr_code_page_home')

  const handleDownload = () => {
    if (!parsedResult?.base64) return

    // Create a link and trigger download
    const link = document.createElement('a')
    link.href = parsedResult.base64
    link.download = `qr-code-${pageName?.toLowerCase().replace(/\//g, '-') || 'page'}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleModalOpen = () => {
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
  }

  const modalContent = typeof document !== 'undefined' && (
    <AnimatePresence>
      {isModalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-intents-ux-boxHighContrastOverlay-backgroundColor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={handleModalClose}
          />

          {/* Modal Container */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-2"
            onClick={handleModalClose}
          >
            <motion.div
              className="max-w-2xl w-full bg-intents-ux-box-backgroundColor p-3 rounded-lg shadow-xl relative flex flex-col"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <div className="absolute top-1.5 right-1.5">
                <Button
                  onClick={handleModalClose}
                  icon={<XThickIcon className="h-3 w-3" />}
                  design="control"
                  aria-label={t('builder_qr_code_close_button_aria')}
                  size="sm"
                />
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold mb-2">
                {t('builder_qr_code_title_for_page', { pageName })}
              </h2>

              {/* QR Code Display */}
              {hasQRCode && parsedResult && (
                <div className="flex flex-col items-center gap-3">
                  {/* QR Code Image */}
                  <div className="flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={parsedResult.base64}
                      alt={t('builder_qr_code_image_alt', { targetUrl: parsedResult.targetUrl })}
                      className="w-full max-w-md"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>

                  {/* Target URL Info */}
                  <div className="text-center w-full">
                    <p className="text-sm text-foreground/70 mb-1">{t('builder_qr_code_scans_to_label')}</p>
                    <a
                      href={parsedResult.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-mono text-primary hover:underline break-all"
                    >
                      {parsedResult.targetUrl}
                    </a>
                  </div>

                  {/* Download Button */}
                  <Button
                    onClick={handleDownload}
                    icon={<Download className="w-3 h-3" />}
                    design="primary"
                    size="md"
                  >
                    {t('builder_qr_code_download_button')}
                  </Button>
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  const displayName = toolStatus === 'completed' && hasQRCode
    ? t('builder_qr_code_title_for_page', { pageName })
    : t('builder_qr_code_title')

  const icon = <QrCode className="w-2 h-2" />

  return (
    <div>
      <ToolHeader
        icon={icon}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasQRCode}
        onOpenModal={hasQRCode ? handleModalOpen : undefined}
      />

      {/* Inline QR Code Display */}
      {toolStatus === 'completed' && hasQRCode && parsedResult && (
        <div className="my-2">
          <div className="flex flex-col gap-2">
            {/* QR Code Image */}
            <button
              onClick={handleModalOpen}
              className="cursor-pointer hover:opacity-80 transition-opacity"
              title={t('builder_qr_code_enlarge_hint')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={parsedResult.base64}
                alt={t('builder_qr_code_image_alt', { targetUrl: parsedResult.targetUrl })}
                className="w-full max-w-[200px] mx-auto"
                style={{ imageRendering: 'pixelated' }}
              />
            </button>

            {/* Quick Info */}
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center gap-1.5 text-foreground/70">
                <span className="font-medium">{t('builder_qr_code_scans_to_label')}</span>
                <a
                  href={parsedResult.targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline truncate"
                >
                  {parsedResult.targetUrl}
                </a>
              </div>
              <Button
                onClick={handleDownload}
                icon={<Download className="w-2.5 h-2.5" />}
                design="secondary"
                size="sm"
              >
                {t('builder_qr_code_download_button_short')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {typeof document !== 'undefined' && modalContent && createPortal(modalContent, document.body)}
    </div>
  )
}
