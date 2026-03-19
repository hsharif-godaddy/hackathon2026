import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { parse } from 'yaml'

import { LANDING_PREFIX } from '@/data/landing-pages/constants'
import lookup from '@/data/landing-pages/lookup.json'
import LandingPage from './components/LandingPage'
import { LandingPageData } from './components/types'

interface PageParams {
  name: string
  lang?: string[]
}

const DATA_DIR = path.join(process.cwd(), 'src', 'data', 'landing-pages')

async function loadPage(filePath: string): Promise<LandingPageData> {
  const content = await readFile(path.join(DATA_DIR, filePath), 'utf8')
  return parse(content) as LandingPageData
}

function resolveRouteKey(name: string, lang?: string[]): string {
  if (lang?.length) {return `${name}/${lang[0]}`}
  return name
}

async function resolveBaseUrl(): Promise<string> {
  try {
    const host = (await headers()).get('host')
    if (host) {
      const protocol = host.startsWith('localhost') ? 'http' : 'https'
      return `${protocol}://${host}`
    }
  } catch {
    // headers() unavailable during static generation
  }

  if (process.env.LOGIN_REDIRECT_URL) {
    try {
      return new URL(process.env.LOGIN_REDIRECT_URL).origin
    } catch {
      // invalid URL, fall through
    }
  }

  return 'https://airo-builder.godaddy.com'
}

export async function generateMetadata(
  { params }: { params: Promise<PageParams> }
): Promise<Metadata> {
  const { name, lang } = await params
  if (lang && lang.length > 1) {return {}}

  const route = lookup.routes[resolveRouteKey(name, lang)]
  if (!route) {return {}}

  const [data, baseUrl] = await Promise.all([loadPage(route.file), resolveBaseUrl()])

  const alternateLanguages: Record<string, string> = {}
  for (const alt of lookup.alternates[route.useCase] ?? []) {
    const href = alt.lang
      ? `${baseUrl}/${LANDING_PREFIX}/${alt.name}/${alt.lang}`
      : `${baseUrl}/${LANDING_PREFIX}/${alt.name}`
    alternateLanguages[alt.hreflang] = href
  }

  // x-default points to English version
  const enAlternate = (lookup.alternates[route.useCase] ?? []).find(a => a.hreflang === 'en')
  if (enAlternate) {
    const href = enAlternate.lang
      ? `${baseUrl}/${LANDING_PREFIX}/${enAlternate.name}/${enAlternate.lang}`
      : `${baseUrl}/${LANDING_PREFIX}/${enAlternate.name}`
    alternateLanguages['x-default'] = href
  }

  return {
    title: data.meta.title,
    description: data.meta.description,
    robots: { index: true, follow: false },
    alternates: { languages: alternateLanguages },
  }
}

export default async function LandingPageRoute(
  { params }: { params: Promise<PageParams> }
) {
  const { name, lang } = await params

  // Only allow 0 or 1 language segment
  if (lang && lang.length > 1) {
    if (lookup.routes[name]) {
      redirect(`/${LANDING_PREFIX}/${name}`)
    }
    redirect('/')
  }

  const route = lookup.routes[resolveRouteKey(name, lang)]
  if (!route) {
    // Invalid lang — fall back to the base name if it exists
    if (lang?.length && lookup.routes[name]) {
      redirect(`/${LANDING_PREFIX}/${name}`)
    }
    redirect('/')
  }

  return <LandingPage data={await loadPage(route.file)} />
}
