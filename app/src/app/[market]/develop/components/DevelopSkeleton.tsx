'use client'

import { useEffect, useState } from 'react'

import { BuilderLayout } from '@/app/[market]/commander/types'
import { useBuilderLayout } from '@/app/[market]/commander/useBuilderLayout'
import ChatMessagesSkeleton from '@/app/[market]/develop/components/chat/ChatMessagesSkeleton'
import PreviewSkeleton from '@/app/[market]/develop/components/preview/PreviewSkeleton'
import StaticSkeleton from '@/app/[market]/develop/components/StaticSkeleton'
import { useIsMobile } from '@/hooks/useIsMobile'
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

// useIsMobile relies on window.matchMedia, unavailable during SSR.
// The server always renders the desktop tree; on mobile clients the mounted
// guard delays layout resolution until after hydration. The root element
// starts at opacity-0 and fades in once mounted is true, so the brief
// desktop-to-mobile swap is invisible to the user.
export default function DevelopSkeleton({ isFallback = false }: { isFallback?: boolean }) {
  const isMobile = useIsMobile()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const isMobileLayout = mounted && isMobile
  // Match the placeholder to the layout this session resolves into — the immersive layout
  // gets a minimal header + a centered, large chat column, not the full develop chrome.
  const layout: BuilderLayout = useBuilderLayout()

  // Gate on `mounted` like the mobile/desktop swap below: `useBuilderLayout` reads
  // client-only switchboard data, so the server renders `Develop` (the normal skeleton)
  // and only the client knows it's a design-kit (Immersive) session. Without the gate the
  // client's first render would diverge from the SSR'd fallback → hydration mismatch.
  if (mounted && layout === BuilderLayout.Immersive) {
    return (
      <div
        data-testid="develop-skeleton"
        className={`absolute inset-0 flex flex-col overflow-hidden bg-develop-bg transition-opacity duration-200 ${mounted || isFallback ? 'opacity-100' : 'opacity-0'}`}
      >
        {/* Minimal header — mirrors DesignKitChatHeader (Airo logo + user menu only). */}
        <header className="flex shrink-0 items-center justify-between gap-2 p-1.5 md:p-2.5">
          <div className="flex items-center gap-1">
            <StaticSkeleton width="60px" height="24px" />
            <StaticSkeleton width="40px" height="20px" />
          </div>
          <StaticSkeleton rounding="full" width="32px" height="32px" />
        </header>

        {/* Centered, large chat column (the gathering look): messages + composer, no toolbar. */}
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
            <div className="flex-1 overflow-hidden pl-2">
              <ChatMessagesSkeleton />
            </div>
            <ChatInputSkeleton />
          </div>
        </div>
      </div>
    )
  }

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
            <PreviewSkeleton testId="develop-skeleton-preview" />
          </div>
        </>
      )}
    </div>
  )
}
