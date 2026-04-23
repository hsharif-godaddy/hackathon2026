'use client'

import { useEffect, useState } from 'react'

import ChatMessagesSkeleton from '@/app/[market]/develop/components/chat/ChatMessagesSkeleton'
import StaticSkeleton from '@/app/[market]/develop/components/StaticSkeleton'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { DEFAULT_CHAT_PANE_WIDTH } from '@/stores/useDevelopPageStore'

function ChatInputSkeleton() {
  return (
    <div className="pl-2 mt-1 pb-2">
      <div className="flex flex-col p-1.5 mb-px bg-intents-ux-box-backgroundColor shadow-md rounded-lg">
        <StaticSkeleton width="100%" height="60px" className="mb-1" />
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1">
            <StaticSkeleton width="38px" height="38px" />
            <StaticSkeleton rounding="full" width="32px" height="32px" />
          </div>
          <div className="flex items-center gap-0.5">
            <StaticSkeleton width="38px" height="38px" />
            <StaticSkeleton width="38px" height="38px" />
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolbarSkeleton() {
  return (
    <div className="px-2 pb-2 flex items-center">
      <div className="flex items-center gap-0.5 bg-intents-ux-box-backgroundColor rounded-sm p-0.5">
        <StaticSkeleton width="100px" height="36px" />
        <StaticSkeleton width="36px" height="36px" />
        <StaticSkeleton width="36px" height="36px" />
        <StaticSkeleton width="36px" height="36px" />
        <StaticSkeleton width="36px" height="36px" />
      </div>
    </div>
  )
}

// useBreakpoints relies on window.matchMedia, unavailable during SSR.
// The server always renders the desktop tree; on mobile clients the mounted
// guard delays layout resolution until after hydration. The root element
// starts at opacity-0 and fades in once mounted is true, so the brief
// desktop-to-mobile swap is invisible to the user.
export default function DevelopSkeleton({ isFallback = false }: { isFallback?: boolean }) {
  const { isBelowSmBreakpoint } = useBreakpoints()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const isMobileLayout = mounted && isBelowSmBreakpoint

  return (
    <div
      data-testid="develop-skeleton"
      className={`absolute inset-0 flex flex-col overflow-hidden bg-develop-bg transition-opacity duration-200 ${mounted || isFallback ? 'opacity-100' : 'opacity-0'}`}
    >
      {isMobileLayout ? (
        <>
          <header className="flex items-center p-1.5">
            <div className="flex items-center gap-1">
              <StaticSkeleton width="56px" height="24px" />
              <StaticSkeleton width="40px" height="18px" />
            </div>
            <div className="grow flex justify-end items-center gap-1 px-0.5 py-1 md:px-1.5">
              <div className="flex items-center gap-0.5 bg-intents-ux-box-backgroundColor rounded-sm p-0.5">
                <StaticSkeleton width="92px" height="35px" />
                <StaticSkeleton width="35px" height="35px" />
              </div>
              <StaticSkeleton width="35px" height="35px" />
            </div>
          </header>

          <div className="relative flex-1 flex flex-col overflow-hidden min-h-0 pr-2">
            <div className="flex-1 overflow-hidden pl-2">
              <ChatMessagesSkeleton />
            </div>
            <ChatInputSkeleton />
            <ToolbarSkeleton />
          </div>
        </>
      ) : (
        <>
          <header className="flex">
            <div className="p-1.5 md:ps-2.5 md:pe-0 shrink-0 flex items-center justify-between gap-1.5" style={{ width: DEFAULT_CHAT_PANE_WIDTH }}>
              <div className="flex items-center gap-1">
                <StaticSkeleton width="60px" height="24px" />
                <StaticSkeleton width="40px" height="20px" />
              </div>
              <StaticSkeleton width="28px" height="28px" />
            </div>
            <div className="p-1.5 md:p-2.5 grow flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-0.5 bg-intents-ux-box-backgroundColor rounded-sm p-0.5">
                  <StaticSkeleton width="38px" height="38px" />
                  <StaticSkeleton width="92px" height="38px" />
                  <StaticSkeleton width="38px" height="38px" />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <StaticSkeleton width="38px" height="38px" />
                <StaticSkeleton width="38px" height="38px" />
                <StaticSkeleton width="38px" height="38px" />
                <StaticSkeleton width="38px" height="38px" />
                <div className="flex items-center gap-0.5 bg-intents-ux-box-backgroundColor rounded-sm p-0.5">
                  <StaticSkeleton width="100px" height="38px" />
                  <StaticSkeleton width="64px" height="38px" />
                </div>
                <StaticSkeleton width="38px" height="38px" />
              </div>
            </div>
          </header>

          <div className="relative flex-1 flex overflow-hidden min-h-0">
            <div className="flex flex-col shrink-0" style={{ width: DEFAULT_CHAT_PANE_WIDTH }}>
              <div className="flex items-center gap-1 px-3 py-2">
                <StaticSkeleton width="100px" height="18px" />
                <StaticSkeleton width="14px" height="14px" />
              </div>
              <div className="flex-1 overflow-hidden pl-2">
                <ChatMessagesSkeleton />
              </div>
              <ChatInputSkeleton />
              <ToolbarSkeleton />
            </div>
            <div data-testid="develop-skeleton-preview" className="flex-1 flex flex-col items-center justify-center gap-8 mt-6 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg mx-1 md:mr-2.5">
              <div className="flex flex-col items-center gap-4">
                <StaticSkeleton width="96px" height="96px" />
                <StaticSkeleton width="200px" height="24px" />
              </div>
              <div className="w-full max-w-2xl px-3">
                <div className="min-h-24 p-2">
                  <div className="rounded-lg shadow-sm px-4 py-4 flex gap-2 bg-intents-ux-box-backgroundColor">
                    <StaticSkeleton rounding="full" width="24px" height="24px" className="shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-2 flex-1">
                      <StaticSkeleton width="50%" height="14px" />
                      <StaticSkeleton width="95%" height="12px" />
                      <StaticSkeleton width="75%" height="12px" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
