# Components

## shadcn/ui Components

All components are pre-installed in `src/components/ui/`. Import pattern:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
```

### Available Components

| Component | File | Notes |
|---|---|---|
| Accordion | `accordion.tsx` | Radix-based collapsible sections |
| AlertDialog | `alert-dialog.tsx` | Modal confirmation dialogs |
| Alert | `alert.tsx` | Inline status messages |
| AspectRatio | `aspect-ratio.tsx` | Constrain content to a ratio |
| Avatar | `avatar.tsx` | User avatar with fallback initials |
| Badge | `badge.tsx` | Status/label chips |
| Breadcrumb | `breadcrumb.tsx` | Navigation breadcrumbs |
| Button | `button.tsx` | CVA-based with variants: default, destructive, outline, secondary, ghost, link |
| Calendar | `calendar.tsx` | Date picker (uses `react-day-picker`) |
| Card | `card.tsx` | Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription |
| Carousel | `carousel.tsx` | Embla + `embla-carousel-autoplay`; never hand-roll (`setInterval`/`setTimeout`). Existing non-Embla rotators: add `aria-roledescription="carousel"`. Full-bleed overlays: `pointer-events-none`, interactive children `pointer-events-auto`. |
| Checkbox | `checkbox.tsx` | |
| Collapsible | `collapsible.tsx` | |
| Command | `command.tsx` | cmdk command palette |
| ContextMenu | `context-menu.tsx` | Right-click menus |
| Dialog | `dialog.tsx` | Modal dialogs |
| Drawer | `drawer.tsx` | Vaul bottom drawer |
| DropdownMenu | `dropdown-menu.tsx` | |
| Form | `form.tsx` | react-hook-form integration with Zod |
| HoverCard | `hover-card.tsx` | |
| InputOTP | `input-otp.tsx` | OTP input fields |
| Input | `input.tsx` | |
| Label | `label.tsx` | |
| Menubar | `menubar.tsx` | |
| NavigationMenu | `navigation-menu.tsx` | Mega-nav with submenus |
| Pagination | `pagination.tsx` | |
| Popover | `popover.tsx` | |
| Progress | `progress.tsx` | |
| Resizable | `resizable.tsx` | `react-resizable-panels` wrapper |
| ScrollArea | `scroll-area.tsx` | Custom scrollbar |
| Select | `select.tsx` | |
| Separator | `separator.tsx` | |
| Sheet | `sheet.tsx` | Side drawer/panel |
| Skeleton | `skeleton.tsx` | Loading placeholder |
| Slider | `slider.tsx` | |
| Sonner | `sonner.tsx` | Toast notifications (Sonner) |
| Switch | `switch.tsx` | |
| Table | `table.tsx` | Table, TableHeader, TableBody, TableRow, TableCell, etc. |
| Tabs | `tabs.tsx` | |
| Textarea | `textarea.tsx` | |
| Toggle | `toggle.tsx` | |
| Tooltip | `tooltip.tsx` | |

## Forms

Forms use `react-hook-form` + `zod` (via `@hookform/resolvers/zod`) wired through the shadcn `Form` / `FormField` / `FormItem` / `FormControl` / `FormMessage` primitives in `@/components/ui/form`.

## Icons & Utility

- Icons: `lucide-react` (`^0.454`) and `@heroicons/react` are both installed.
- `cn()` from `@/lib/utils` (clsx + tailwind-merge) for conditional class merging.

## Other Installed Components

- `src/components/Spinner.tsx` — loading spinner used by SSR fallback
- `src/components/CookieBanner.tsx` — GDPR cookie notice with error boundary
- `src/components/DemoContent.tsx` — placeholder content for new apps
