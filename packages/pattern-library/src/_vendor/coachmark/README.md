# Coachmark (vendored)

> **⚠️ Temporary vendor.** This component is copied from
> `@ux/coachmark` release `2500.11.1` (release-2500 line). It exists so
> Airo can use coachmarks without the fullscreen `Disrupt`/`Spotlight`
> backdrop.
>
> Local change: added `disableBackdrop` (default `true`) and
> `hideNavigation` props.

## Import

```tsx
import { Coachmark } from '@airo-ux/pattern-library/_vendor/coachmark';
import '@airo-ux/pattern-library/_vendor/coachmark/styles';
```

## Swap-back recipe

When upstream supports non-blocking coachmarks:

1. Replace consumers with `@ux/coachmark`.
2. Delete `src/_vendor/coachmark/`.
3. Remove `_vendor/coachmark` entries from `tsup.config.ts` and `package.json#exports`.
