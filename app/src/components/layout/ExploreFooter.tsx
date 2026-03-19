'use client'

import Link from 'next/link'
import text from '@ux/text'

import PageSection from '@/components/layout/PageSection'
import lookup from '@/data/landing-pages/lookup.json'

export default function ExploreFooter() {
  if (!lookup.pages.length) {return null}

  return (
    <PageSection>
      <nav
        aria-label="Explore pages"
        className="max-w-screen-lg mx-auto border-t border-white/10 pt-6"
      >
        <text.p size={-1} className="!font-semibold uppercase tracking-wider opacity-60 mb-3">
          Explore
        </text.p>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 list-none p-0 m-0">
          {lookup.pages.map(function renderPage(page) {
            return (
              <li key={page.href}>
                <Link
                  href={page.href}
                  className="text-inherit opacity-80 hover:opacity-100 transition-opacity no-underline hover:underline text-sm"
                >
                  {page.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </PageSection>
  )
}
