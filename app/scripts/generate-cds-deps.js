import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { exit } from 'node:process'

const { generateCdsDependencies } = await import('@venture/cds-utils')

const componentTypes = ['godaddyUnifiedPlansAndPricingLibraryEsm', 'multiusersEsm']
const depsPath = 'cds'

// Host-supplied deps that @venture/cds-utils can't auto-resolve in pnpm workspaces.
// These are appended after auto-generation. Following the Muse/BAM pattern:
// react/jsx-runtime forces CDS to use the host's React 19 jsx-runtime instead of
// its vendored React 18 copy, eliminating $$typeof / Symbol.for mismatches.
const manualDeps = [
  { specifier: 'react/jsx-runtime', importName: 'jsxRuntime', importPath: 'react/jsx-runtime', versionExpr: 'react.version' },
  { specifier: 'axios', importName: 'axios', importPath: 'axios' },
  { specifier: '@ux/util', importName: 'uxUtil', importPath: '@ux/util' },
  { specifier: 'react-device-detect', importName: 'reactDeviceDetect', importPath: 'react-device-detect' },
  { specifier: 'react-focus-lock', importName: 'reactFocusLock', importPath: 'react-focus-lock' },
  { specifier: 'react-transition-group', importName: 'reactTransitionGroup', importPath: 'react-transition-group' },
  // multiusersEsm's cds-cli@0.0.92 manifest excludes react/react-dom/react-router-dom
  // from its CDN fallback set, so the host must supply react-router-dom.
  // (react and react-dom are already in the auto-generated deps via @venture/cds-utils.)
  { specifier: 'react-router-dom', importName: 'reactRouterDom', importPath: 'react-router-dom' },
  // Fallback only: @venture/cds-utils always auto-generates an `events` dep, so
  // this entry is skipped by the `includes('events')` guard below. The named
  // EventEmitter export is actually supplied by the post-generation rewrite
  // further down (`import * as events from 'events'` → '../src/lib/cdsEventsShim').
  // Kept so events stays host-supplied if the auto-generated set ever drops it.
  { specifier: 'events', importName: 'events', importPath: '../src/lib/cdsEventsShim' },
  // multiusersEsm imports its UI primitives from the HOST (it ships no `ux-*`
  // fallback bundles, unlike the paywall component). The @venture/cds-utils
  // auto-generator drops these because the manifest pins ^2400 while we ship
  // 2500, so without forcing them here every @ux/* import resolves to undefined
  // and the team UI renders empty (no permission checkboxes, dead "…" menu,
  // blank role select). The working venture dashboard supplies these same
  // components to the bundle. UXCore is forward-compatible (GoDaddy is on 2500),
  // so providing our installed 2500 builds is correct. Keep this list in sync
  // with what multiusersEsm imports.
  { specifier: '@ux/button', importName: 'uxButton', importPath: '@ux/button' },
  { specifier: '@ux/modal', importName: 'uxModal', importPath: '@ux/modal' },
  { specifier: '@ux/spinner', importName: 'uxSpinner', importPath: '@ux/spinner' },
  { specifier: '@ux/alert', importName: 'uxAlert', importPath: '@ux/alert' },
  { specifier: '@ux/flyout', importName: 'uxFlyout', importPath: '@ux/flyout' },
  { specifier: '@ux/growl', importName: 'uxGrowl', importPath: '@ux/growl' },
  { specifier: '@ux/icon', importName: 'uxIcon', importPath: '@ux/icon' },
  { specifier: '@ux/radio', importName: 'uxRadio', importPath: '@ux/radio' },
  { specifier: '@ux/sibling-set', importName: 'uxSiblingSet', importPath: '@ux/sibling-set' },
  { specifier: '@ux/tag', importName: 'uxTag', importPath: '@ux/tag' },
  { specifier: '@ux/text', importName: 'uxText', importPath: '@ux/text' },
  { specifier: '@ux/tooltip', importName: 'uxTooltip', importPath: '@ux/tooltip' },
  { specifier: '@ux/card', importName: 'uxCard', importPath: '@ux/card' },
  { specifier: '@ux/select-input', importName: 'uxSelectInput', importPath: '@ux/select-input' },
  { specifier: '@ux/search', importName: 'uxSearch', importPath: '@ux/search' },
  { specifier: '@ux/text-input', importName: 'uxTextInput', importPath: '@ux/text-input' },
  { specifier: '@ux/box', importName: 'uxBox', importPath: '@ux/box' },
  { specifier: '@ux/checkbox', importName: 'uxCheckbox', importPath: '@ux/checkbox' },
  { specifier: '@ux/menu', importName: 'uxMenu', importPath: '@ux/menu' },
  { specifier: '@ux/intents', importName: 'uxIntents', importPath: '@ux/intents' },
  { specifier: '@ux/tooltip-legacy', importName: 'uxTooltipLegacy', importPath: '@ux/tooltip-legacy' },
  { specifier: '@ux/dialog', importName: 'uxDialog', importPath: '@ux/dialog' },
  { specifier: '@ux/space', importName: 'uxSpace', importPath: '@ux/space' },
  { specifier: '@ux/progress-bar', importName: 'uxProgressBar', importPath: '@ux/progress-bar' },
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
      newExports.push(`  '${dep.specifier}': { module: __ensureDefaultExport(${dep.importName}), version: ${version} },`)
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
    }

    // multiusersEsm@a6f665880's classic-runtime createElement reads
    // `react.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner`
    // — that property was renamed to `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`
    // in React 19, and ReactCurrentOwner was removed entirely. Without a host
    // shim the bundle crashes on module init. cds-cli@0.0.92 made other access
    // sites Wave-2-aware (R19-key first, R18-key fallback) but the
    // createElement plumbing wasn't migrated.
    //
    // Wrap the host-supplied `react` entry with an alias from R19's
    // CLIENT_INTERNALS to the R18 SECRET_INTERNALS name and stub the missing
    // ReactCurrentOwner slot. Host application code keeps importing real
    // React 19 directly from 'react' — only the CDS loader's __CDS_ESM_LIBS__
    // map sees the wrapper. Remove this once multiusersEsm is rebuilt with
    // the modern jsx-runtime that doesn't read these internals at all.
    const shimBlock =
      '\n// Guarantee every host-supplied module exposes a `default` export. Some @ux\n' +
      '// ESM builds (e.g. @ux/menu) ship named-only; CDS bundles that `import X from`\n' +
      '// them otherwise receive undefined and the component (e.g. the row "…" menu)\n' +
      '// never renders. Mirrors the CJS-interop default the working venture host has.\n' +
      'const __ensureDefaultExport = (m) => (m && typeof m === \'object\' && \'default\' in m) ? m : Object.assign({}, m, { default: m });\n\n' +
      '// CDS-only React shim: alias R19 CLIENT_INTERNALS to R18 SECRET_INTERNALS\n' +
      '// for bundles whose createElement still hard-codes the old name.\n' +
      'const reactWithR18Internals = (() => {\n' +
      '  const wrapped = Object.assign({}, react);\n' +
      '  if (!wrapped.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED) {\n' +
      '    const r19 = react.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;\n' +
      '    if (r19) wrapped.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = r19;\n' +
      '  }\n' +
      '  const secret = wrapped.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;\n' +
      '  if (secret && !secret.ReactCurrentOwner) secret.ReactCurrentOwner = { current: null };\n' +
      '  return wrapped;\n' +
      '})();\n\n'
    const afterShimDecl = content.replace(/^(export default \{)/m, shimBlock + '$1')
    if (afterShimDecl === content) {
      console.error('CDS::esm - react shim declaration regex did not match deps-esm.js')
      exit(1)
    }
    const afterShimSwap = afterShimDecl.replace(
      /('react':\s*\{\s*module:\s*)react(,\s*version:\s*'[^']+'\s*\})/,
      '$1reactWithR18Internals$2'
    )
    if (afterShimSwap === afterShimDecl) {
      console.error("CDS::esm - 'react' specifier swap regex did not match deps-esm.js")
      exit(1)
    }
    content = afterShimSwap

    // The CDS loader's blob generator re-exports only keys it finds via
    // Object.keys() on the host module namespace. @venture/cds-utils
    // auto-generates `import * as events from 'events'`, but the `events` CJS
    // package exposes only a `default` under ESM interop — no enumerable named
    // `EventEmitter`. So the loader's blob omits `export const EventEmitter`,
    // and any bundle doing `class X extends events.EventEmitter` (e.g. the
    // paywall's wsb-dify-lead-gen settings resolver) gets `extends undefined`
    // → "Class extends value undefined". cdsEventsShim re-exports EventEmitter
    // as a NAMED export precisely so Object.keys() picks it up; the manualDeps
    // entry above is skipped because the auto-generated raw import already
    // satisfies the `includes('events')` guard, so rewrite the source here.
    const rawEventsImport = "import * as events from 'events';"
    if (content.includes(rawEventsImport)) {
      content = content.replace(rawEventsImport, "import * as events from '../src/lib/cdsEventsShim';")
      console.log('CDS::esm - Rewired host `events` dep to cdsEventsShim (named EventEmitter export)')
    } else {
      console.error("CDS::esm - expected `import * as events from 'events';` not found; events EventEmitter export may be missing")
      exit(1)
    }

    writeFileSync(depsFile, content)
    if (newImports.length > 0) {
      const added = manualDeps.filter(d => newImports.some(imp => imp.includes(d.importName)))
      console.log(`CDS::esm - Appended ${added.length} manual host deps: ${added.map(d => d.specifier).join(', ')}`)
    }
    console.log('CDS::esm - Applied React 18 internals alias shim to host `react` entry')

    exit(0)
  })
  .catch((error) => {
    console.error('CDS ESM deps generation failed:', error)
    exit(1)
  })
