import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { isOriginAllowed } from '../utils/postMessage'
import { send } from '../utils/eventBus'
import { QuickEditBar } from './QuickEditBar'

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

interface AnnotationSelection {
  id: number
  number: number
  rect: Box
  prompt: string
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

const BADGE_STYLES: React.CSSProperties = {
  minWidth: '20px',
  height: '20px',
  padding: '0 5px',
  borderRadius: '10px',
  background: STROKE_COLOR,
  color: 'white',
  fontSize: '11px',
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'system-ui, sans-serif',
  cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  transition: 'background 0.15s',
  pointerEvents: 'auto',
  userSelect: 'none',
}

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

interface BadgeProps {
  number: number
  onRemove: () => void
}

function NumberBadge({ number, onRemove }: BadgeProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      data-airo-dev-tools=""
      style={{
        ...BADGE_STYLES,
        background: hovered ? '#6d28d9' : STROKE_COLOR,
      }}
      title="Remove selection"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove() }}
    >
      {hovered ? '✕' : `#${number}`}
    </div>
  )
}

export default function AnnotationMode({ isActive }: AnnotationModeProps) {
  const [selections, setSelections] = useState<AnnotationSelection[]>([])
  const [pendingRect, setPendingRect] = useState<Box | null>(null)
  const [draft, setDraft] = useState<DraftBox | null>(null)
  const [docSize, setDocSize] = useState<DocSize>({ width: 0, height: 0 })
  const overlayRef = useRef<SVGSVGElement | null>(null)
  // nextIdRef tracks the next internal ID (unique per component lifetime)
  const nextIdRef = useRef(1)
  // nextNumberRef tracks the next user-visible selection number
  const nextNumberRef = useRef(1)

  useEffect(() => {
    if (!isActive) {
      setSelections([])
      setPendingRect(null)
      setDraft(null)
      nextNumberRef.current = 1
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

  // Listen for cross-iframe messages from the parent
  useEffect(() => {
    if (!isActive) return

    const handleMessage = (event: MessageEvent) => {
      if (!isOriginAllowed(event)) return
      const { type, data } = event.data ?? {}

      if (type === 'REMOVE_SELECTION' && data?.number != null) {
        setSelections((prev) => prev.filter((s) => s.number !== data.number))
      }

      if (type === 'CLEAR_ALL_SELECTIONS') {
        setSelections([])
        setPendingRect(null)
        nextNumberRef.current = 1
      }

      if (type === 'SCROLL_TO_SELECTION' && data?.number != null) {
        setSelections((prev) => {
          const sel = prev.find((s) => s.number === data.number)
          if (sel) {
            const centerY = sel.rect.y + sel.rect.height / 2
            window.scrollTo({ top: centerY - window.innerHeight / 2, behavior: 'smooth' })
          }
          return prev
        })
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [isActive])

  const handlePointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    // Don't start a new drag if a QuickEditBar is already open
    if (pendingRect) return
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
  }, [pendingRect])

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
      // Show QuickEditBar for this rect (don't finalize to selections yet)
      setPendingRect(finalized)
      return null
    })
  }, [])

  const handlePointerCancel = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    overlayRef.current?.releasePointerCapture(event.pointerId)
    setDraft(null)
  }, [])

  const handleQuickEditSubmit = useCallback((prompt: string) => {
    if (!pendingRect) return
    const selNumber = nextNumberRef.current++
    const newSelection: AnnotationSelection = { id: pendingRect.id, number: selNumber, rect: pendingRect, prompt }
    setSelections((prev) => [...prev, newSelection])
    send({
      type: 'ANNOTATION_SELECTION_CREATED',
      data: {
        number: selNumber,
        rect: { x: pendingRect.x, y: pendingRect.y, width: pendingRect.width, height: pendingRect.height },
        prompt,
      },
    })
    setPendingRect(null)
  }, [pendingRect])

  const handleQuickEditDismiss = useCallback(() => {
    setPendingRect(null)
  }, [])

  const handleRemoveSelection = useCallback((number: number) => {
    setSelections((prev) => prev.filter((s) => s.number !== number))
    send({ type: 'REMOVE_SELECTION_FROM_PREVIEW', data: { number } })
  }, [])

  if (!isActive) return null

  const draftBox = draft ? rectFromDraft(draft) : null

  // Position the QuickEditBar just below the pending rect, clamped to viewport width
  const quickEditTop = pendingRect ? pendingRect.y + pendingRect.height + 8 : 0
  const quickEditLeft = pendingRect ? Math.max(8, Math.min(pendingRect.x, docSize.width - 340)) : 0

  return (
    <>
      {createPortal(
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
            cursor: pendingRect ? 'default' : 'crosshair',
            touchAction: 'none',
            userSelect: 'none',
            pointerEvents: 'all',
          }}
          data-airo-annotation-overlay="true"
        >
          {selections.map((sel) => (
            <rect
              key={sel.id}
              x={sel.rect.x}
              y={sel.rect.y}
              width={sel.rect.width}
              height={sel.rect.height}
              fill={FILL_COLOR}
              stroke={STROKE_COLOR}
              strokeWidth={STROKE_WIDTH}
            />
          ))}
          {pendingRect && (
            <rect
              x={pendingRect.x}
              y={pendingRect.y}
              width={pendingRect.width}
              height={pendingRect.height}
              fill={FILL_COLOR}
              stroke={STROKE_COLOR}
              strokeWidth={STROKE_WIDTH}
              strokeDasharray="6 4"
            />
          )}
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
      )}
      {createPortal(
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: docSize.width,
            height: docSize.height,
            zIndex: Z_INDEX + 1,
            pointerEvents: 'none',
          }}
        >
          {selections.map((sel) => (
            <div
              key={sel.id}
              style={{
                position: 'absolute',
                top: sel.rect.y - 10,
                left: sel.rect.x + sel.rect.width - 10,
                pointerEvents: 'none',
              }}
            >
              <NumberBadge number={sel.number} onRemove={() => handleRemoveSelection(sel.number)} />
            </div>
          ))}
          {pendingRect && (
            <QuickEditBar
              onSubmit={handleQuickEditSubmit}
              onDismiss={handleQuickEditDismiss}
              style={{
                position: 'absolute',
                top: quickEditTop,
                left: quickEditLeft,
                pointerEvents: 'auto',
              }}
            />
          )}
        </div>,
        document.body
      )}
    </>
  )
}
