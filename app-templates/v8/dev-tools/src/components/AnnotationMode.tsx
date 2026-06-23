import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { safePostMessage } from '../utils/postMessage'
import { captureCroppedDocumentScreenshot } from '../utils/screenshot'

interface Box {
  id: number
  x: number
  y: number
  width: number
  height: number
}

interface DraftBox {
  id: number
  startX: number
  startY: number
  currentX: number
  currentY: number
}

interface DocSize {
  width: number
  height: number
}

interface AnnotationModeProps {
  isActive: boolean
}

const STROKE_COLOR = '#8b5cf6'
const FILL_COLOR = 'rgba(139, 92, 246, 0.12)'
const STROKE_WIDTH = 2.5
const MIN_BOX_SIZE = 4
const Z_INDEX = 2147483645
const SCREENSHOT_PADDING = 60

function rectFromDraft(draft: DraftBox): Box {
  const x = Math.min(draft.startX, draft.currentX)
  const y = Math.min(draft.startY, draft.currentY)
  return {
    id: draft.id,
    x,
    y,
    width: Math.abs(draft.currentX - draft.startX),
    height: Math.abs(draft.currentY - draft.startY),
  }
}

function getDocSize(): DocSize {
  return {
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }
}

export default function AnnotationMode({ isActive }: AnnotationModeProps) {
  const [boxes, setBoxes] = useState<Box[]>([])
  const [draft, setDraft] = useState<DraftBox | null>(null)
  const [docSize, setDocSize] = useState<DocSize>({ width: 0, height: 0 })
  const overlayRef = useRef<SVGSVGElement | null>(null)
  const nextIdRef = useRef(1)

  useEffect(() => {
    if (!isActive) {
      setBoxes([])
      setDraft(null)
      return
    }

    const update = () => setDocSize(getDocSize())
    update()
    window.addEventListener('resize', update)
    const observer = new ResizeObserver(update)
    observer.observe(document.body)
    return () => {
      window.removeEventListener('resize', update)
      observer.disconnect()
    }
  }, [isActive])

  const sendScreenshot = useCallback(async (currentBoxes: Box[]) => {
    if (currentBoxes.length === 0 || window.parent === window) return

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const box of currentBoxes) {
      minX = Math.min(minX, box.x)
      minY = Math.min(minY, box.y)
      maxX = Math.max(maxX, box.x + box.width)
      maxY = Math.max(maxY, box.y + box.height)
    }

    const cropX = minX - SCREENSHOT_PADDING
    const cropY = minY - SCREENSHOT_PADDING
    const cropWidth = (maxX - minX) + SCREENSHOT_PADDING * 2
    const cropHeight = (maxY - minY) + SCREENSHOT_PADDING * 2

    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const screenshot = await captureCroppedDocumentScreenshot(cropX, cropY, cropWidth, cropHeight)
    if (!screenshot) return
    safePostMessage(window.parent, { type: 'ANNOTATION_SCREENSHOT_RESPONSE', screenshot })
  }, [])

  const handlePointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    overlayRef.current?.setPointerCapture(event.pointerId)
    const docX = event.clientX + window.scrollX
    const docY = event.clientY + window.scrollY
    setDraft({
      id: nextIdRef.current++,
      startX: docX,
      startY: docY,
      currentX: docX,
      currentY: docY,
    })
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    setDraft((prev) =>
      prev
        ? { ...prev, currentX: event.clientX + window.scrollX, currentY: event.clientY + window.scrollY }
        : prev
    )
  }, [])

  const handlePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    overlayRef.current?.releasePointerCapture(event.pointerId)
    setDraft((prev) => {
      if (!prev) return null
      const finalized = rectFromDraft({
        ...prev,
        currentX: event.clientX + window.scrollX,
        currentY: event.clientY + window.scrollY,
      })
      if (finalized.width < MIN_BOX_SIZE || finalized.height < MIN_BOX_SIZE) return null
      setBoxes((existing) => {
        const next = [...existing, finalized]
        void sendScreenshot(next)
        return next
      })
      return null
    })
  }, [sendScreenshot])

  const handlePointerCancel = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    overlayRef.current?.releasePointerCapture(event.pointerId)
    setDraft(null)
  }, [])

  if (!isActive) return null

  const draftBox = draft ? rectFromDraft(draft) : null

  // Render into document.body to escape the dev-tools injected container,
  // which is position:fixed and would lock the overlay to the viewport.
  return createPortal(
    <svg
      ref={overlayRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      width={docSize.width}
      height={docSize.height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: docSize.width,
        height: docSize.height,
        zIndex: Z_INDEX,
        cursor: 'crosshair',
        touchAction: 'none',
        userSelect: 'none',
        pointerEvents: 'all',
      }}
      data-airo-annotation-overlay="true"
    >
      {boxes.map((box) => (
        <rect
          key={box.id}
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill={FILL_COLOR}
          stroke={STROKE_COLOR}
          strokeWidth={STROKE_WIDTH}
        />
      ))}
      {draftBox && draftBox.width >= MIN_BOX_SIZE && draftBox.height >= MIN_BOX_SIZE && (
        <rect
          x={draftBox.x}
          y={draftBox.y}
          width={draftBox.width}
          height={draftBox.height}
          fill={FILL_COLOR}
          stroke={STROKE_COLOR}
          strokeWidth={STROKE_WIDTH}
          strokeDasharray="6 4"
        />
      )}
    </svg>,
    document.body
  )
}
