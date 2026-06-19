import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { exit } from 'node:process'

const { generateCdsDependencies } = await import('@venture/cds-utils')

const componentTypes = ['godaddyUnifiedPlansAndPricingLibraryEsm']
const depsPath = 'cds'

// Host-supplied deps that @venture/cds-utils can't auto-resolve in pnpm workspaces.
// These are appended after auto-generation. Following the Muse/BAM pattern:
// react/jsx-runtime forces CDS to use the host's React 19 jsx-runtime instead of
// its vendored React 18 copy, eliminating $$typeof / Symbol.for mismatches.
const manualDeps = [
  { specifier: 'react/jsx-runtime', importName: 'jsxRuntime', importPath: 'react/jsx-runtime', versionExpr: 'react.version' },
  { specifier: 'axios', importName: 'axios', importPath: 'axios' },
  { specifier: 'events', importName: 'events', importPath: '../src/lib/cdsEventsShim' },
]

generateCdsDependencies({ componentTypes, depsPath })
  .then(() => {
    const depsFile = resolve(depsPath, 'deps-esm.js')
    let content = readFileSync(depsFile, 'utf8')

    const newImports = []
    const newExports = []
    for (const dep of manualDeps) {
      if (content.includes(`'${dep.specifier}'`)) continue
      newImports.push(`import * as ${dep.importName} from '${dep.importPath}';`)
      const version = dep.versionExpr || `'0.0.0'`
      newExports.push(`  '${dep.specifier}': { module: ${dep.importName}, version: ${version} },`)
    }

    if (newImports.length > 0) {
      const importBlock = newImports.join('\n')
      const exportBlock = newExports.join('\n')
      const afterImports = content.replace(
        /^(export default \{)/m,
        `// Host-supplied: react/jsx-runtime forces CDS to use host React 19 jsx-runtime (Muse/BAM pattern)\n${importBlock}\n\n$1`
      )
      if (afterImports === content) {
        console.error('CDS::esm - import-block regex did not match deps-esm.js; generated format may have changed')
        console.error('Head of generated file:', content.slice(0, 500))
        console.error('Tail of generated file:', content.slice(-500))
        exit(1)
      }
      const afterExports = afterImports.replace(
        /(\})\s*\n(\};?\s*)$/,
        `$1,\n${exportBlock}\n};`
      )
      if (afterExports === afterImports) {
        console.error('CDS::esm - export-block regex did not match deps-esm.js; generated format may have changed')
        console.error('Head of generated file:', afterImports.slice(0, 500))
        console.error('Tail of generated file:', afterImports.slice(-500))
        exit(1)
      }
      content = afterExports
      writeFileSync(depsFile, content)
      const added = manualDeps.filter(d => newImports.some(imp => imp.includes(d.importName)))
      console.log(`CDS::esm - Appended ${added.length} manual host deps: ${added.map(d => d.specifier).join(', ')}`)
    }

    exit(0)
  })
  .catch((error) => {
    console.error('CDS ESM deps generation failed:', error)
    exit(1)
  })
