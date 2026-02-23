/**
 * Build script that scans all landing page YAML files and generates lookup.json.
 *
 * Run: pnpm --filter website generate:landing-lookup
 * Or:  npx tsx src/data/landing-pages/generate-lookup.ts
 *
 * Route key format:
 *   - "games"    -> /explore/games       (name only, default English)
 *   - "spiele"   -> /explore/spiele      (localised name)
 *   - "games/hi" -> /explore/games/hi    (English name + language modifier)
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

interface YAMLRoute {
  language: string
  name: string
  label: string
  lang?: string
  useCase: string
}

interface LookupRoute {
  file: string
  language: string
  useCase: string
}

interface LookupAlternate {
  name: string
  lang?: string
  hreflang: string
}

interface LookupPage {
  label: string
  href: string
}

interface Lookup {
  routes: Record<string, LookupRoute>
  alternates: Record<string, LookupAlternate[]>
  pages: LookupPage[]
}

async function generate() {
  const baseDir = path.dirname(fileURLToPath(import.meta.url))
  const lookup: Lookup = { routes: {}, alternates: {}, pages: [] }

  const entries = await readdir(baseDir, { withFileTypes: true })
  const useCaseDirs = entries.filter(e => e.isDirectory())

  // Track English routes per use case for the pages array
  const englishPages = new Map<string, { label: string, href: string }>()

  for (const dir of useCaseDirs) {
    const dirPath = path.join(baseDir, dir.name)
    const files = await readdir(dirPath)
    const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))

    for (const file of yamlFiles) {
      const content = await readFile(path.join(dirPath, file), 'utf8')
      const parsed = parse(content)
      const route = parsed.route as YAMLRoute | undefined

      if (!route?.name || !route?.useCase || !route?.language) {
        console.warn(`Skipping ${dir.name}/${file}: missing route metadata`)
        continue
      }

      const routeKey = route.lang ? `${route.name}/${route.lang}` : route.name
      const relativeFile = `${dir.name}/${file}`

      lookup.routes[routeKey] = {
        file: relativeFile,
        language: route.language,
        useCase: route.useCase,
      }

      if (!lookup.alternates[route.useCase]) {
        lookup.alternates[route.useCase] = []
      }

      const alternate: LookupAlternate = {
        name: route.name,
        hreflang: route.language,
      }
      if (route.lang) {
        alternate.lang = route.lang
      }

      lookup.alternates[route.useCase].push(alternate)

      // Collect English routes for the pages footer list (one per use case)
      if (route.language === 'en' && !route.lang && !englishPages.has(route.useCase)) {
        englishPages.set(route.useCase, {
          label: route.label || route.name,
          href: `/explore/${route.name}`,
        })
      }
    }
  }

  // Build sorted pages array from English routes
  lookup.pages = [...englishPages.values()].sort(
    (a, b) => a.label.localeCompare(b.label)
  )

  const outputPath = path.join(baseDir, 'lookup.json')
  await writeFile(outputPath, JSON.stringify(lookup, null, 2) + '\n')

  const routeCount = Object.keys(lookup.routes).length
  const useCaseCount = Object.keys(lookup.alternates).length
  console.log(`Generated lookup.json: ${routeCount} routes, ${useCaseCount} use cases, ${lookup.pages.length} pages`)
}

generate().catch(console.error)
