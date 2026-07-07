import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { HoverBar, HoverBarButton } from './HoverBar'
import {
  dispatchCarouselSlotNav,
  getCarouselSlotEditRoot,
  isCarouselSlotEditActive,
} from '../utils/carousel-slot-edit'

const EDGE_INSET = 12

export default function CarouselSlotEditNav() {
  const [visible, setVisible] = useState(false)
  const [canScrollPrev, setCanScrollPrev] = useState(false)
  const [canScrollNext, setCanScrollNext] = useState(false)
  // Only the template <Carousel> component fires 'airo:carousel-slot-nav-state'. Hand-rolled carousels never do, so gating on this signal keeps our overlay from stacking on top of the customer's own arrows (where our dispatch would be a no-op anyway).
  const [hasNavState, setHasNavState] = useState(false)
  const [prevStyle, setPrevStyle] = useState<CSSProperties>({})
  const [nextStyle, setNextStyle] = useState<CSSProperties>({})

  const updatePosition = useCallback(function updatePosition() {
    if (!isCarouselSlotEditActive()) {
      setVisible(false)
      return
    }
    const root = getCarouselSlotEditRoot()
    if (!root || !document.body.contains(root)) {
      setVisible(false)
      return
    }
    const rect = root.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    setPrevStyle({
      position: 'fixed',
      left: rect.left + EDGE_INSET,
      top: midY,
      transform: 'translateY(-50%)',
    })
    setNextStyle({
      position: 'fixed',
      left: rect.right - EDGE_INSET,
      top: midY,
      transform: 'translate(-100%, -50%)',
    })
    setVisible(true)
  }, [])

  useEffect(function bindCarouselSlotEditNav() {
    const onSlotEdit = (): void => {
      // Reset nav-state gate on each slot-edit toggle so a stale value from a previous root doesn't leak into the current one.
      setHasNavState(false)
      updatePosition()
    }
    const onNavState = (event: Event): void => {
      const detail = (event as CustomEvent<{
        canScrollPrev?: boolean
        canScrollNext?: boolean
        carouselRoot?: HTMLElement
      }>).detail
      if (!detail?.carouselRoot || detail.carouselRoot !== getCarouselSlotEditRoot()) return
      setCanScrollPrev(detail.canScrollPrev === true)
      setCanScrollNext(detail.canScrollNext === true)
      setHasNavState(true)
    }
    window.addEventListener('airo:carousel-slot-edit', onSlotEdit)
    window.addEventListener('airo:carousel-slot-nav-state', onNavState)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    updatePosition()
    return () => {
      window.removeEventListener('airo:carousel-slot-edit', onSlotEdit)
      window.removeEventListener('airo:carousel-slot-nav-state', onNavState)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [updatePosition])

  useEffect(function observeCarouselRootResize() {
    const root = getCarouselSlotEditRoot()
    if (!root || !visible) return
    const observer = new ResizeObserver(updatePosition)
    observer.observe(root)
    return () => observer.disconnect()
  }, [visible, updatePosition])

  if (!visible || !hasNavState) return null

  return (
    <>
      <div data-airo-non-editable="" style={{ pointerEvents: 'none' }}>
        <HoverBar style={{ ...prevStyle, pointerEvents: 'auto' }}>
          <HoverBarButton
            title="Previous slide"
            icon={<ChevronLeft width={15} height={15} />}
            onClick={() => dispatchCarouselSlotNav('prev')}
            disabled={!canScrollPrev}
          />
        </HoverBar>
      </div>
      <div data-airo-non-editable="" style={{ pointerEvents: 'none' }}>
        <HoverBar style={{ ...nextStyle, pointerEvents: 'auto' }}>
          <HoverBarButton
            title="Next slide"
            icon={<ChevronRight width={15} height={15} />}
            onClick={() => dispatchCarouselSlotNav('next')}
            disabled={!canScrollNext}
          />
        </HoverBar>
      </div>
    </>
  )
}
