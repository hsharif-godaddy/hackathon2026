import { box } from '@ux/box';
import Code from '@ux/code';
import text from '@ux/text';
import classnames from 'classnames';
import { type HTMLAttributes, type ReactNode, isValidElement, useMemo } from 'react';
import Markdown, { type Components, defaultUrlTransform } from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { PluggableList } from 'unified';

const DEFAULT_ARIA_LABEL = 'Assistant response';

// Agent-authored `#`/`##`/`###` headings render as `@ux/text` **titles**, not
// `heading`s. Titles scale via a theme-driven size factor (`size: 0`–`5`), so
// we step down from h1 at size 2 to h3 at size 0 to preserve the visual
// hierarchy without overpowering the surrounding paragraphs.
const TITLE_SIZE_MAP: Record<'h1' | 'h2' | 'h3', number> = {
  h1: 2,
  h2: 1,
  h3: 0,
};

/**
 * Hardened sanitize schema for AI-authored markdown. Extends the GitHub-style
 * default (which already strips scripts, event handlers, and unsafe URL
 * schemes) by narrowing the allowed tag list to the subset this component
 * styles, enforcing an `http`/`https`/`mailto` URL allow-list, and stripping
 * `id` / `name` / `class` / `style` attributes so model output cannot clobber
 * the DOM or bypass the intent-token styling layer.
 *
 * Exported for downstream tests and docs — do not hand-edit the schema shape;
 * either extend via `structuredClone` or accept the defaults.
 */
export const agentMessageSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    'a',
    'blockquote',
    'br',
    'code',
    'em',
    'h1',
    'h2',
    'h3',
    'hr',
    'li',
    'ol',
    'p',
    'pre',
    'strong',
    'ul',
  ],
  attributes: {
    // Drop every attribute the default schema allows (including the GFM
    // footnote `className` rules) so model output cannot spoof classes, IDs,
    // or data attributes that belong to the component itself.
    //
    // `code` is the one exception: fenced code blocks carry a
    // `language-<name>` class token that Prism.JS reads to pick a grammar.
    // The tuple form keeps only class tokens matching `^language-[\w+#-]+$`
    // — everything else (including any style/id/data attributes) is dropped,
    // so model output cannot spoof our own BEM classes through the language
    // slot.
    a: ['href'],
    code: [['className', /^language-[\w+#-]+$/]],
    pre: [],
    ol: ['start'],
    li: [],
  },
  // hast-util-sanitize namespaces any surviving `id` / `name` attributes with
  // this prefix so model output cannot collide with real DOM IDs elsewhere
  // in the page.
  clobberPrefix: 'airo-chat-agent-message-',
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
  },
};

/**
 * Pull only the `language-<name>` class tokens out of a fenced code block's
 * className. The sanitize schema has already filtered the className down to
 * this shape, but our `code` renderer adds its own BEM class before the
 * `pre` renderer sees the child — so we strip those extras back out before
 * forwarding the className to `@ux/code` (whose Prism invocation only cares
 * about the language token).
 */
function extractLanguageClass(className: string | undefined): string | undefined {
  if (!className) return undefined;
  const tokens = className.split(/\s+/).filter((token) => token.startsWith('language-'));
  return tokens.length > 0 ? tokens.join(' ') : undefined;
}

/**
 * `react-markdown`'s default `urlTransform` already blocks `javascript:` and
 * `data:` schemes, but it allows a handful of schemes (e.g. `tel:`, `sms:`)
 * that have no place in agent-authored prose. Pair it with a protocol
 * allow-list so the sanitize step and the URL transform agree on exactly
 * which `href` values survive.
 */
function safeUrlTransform(value: string): string {
  const cleaned = defaultUrlTransform(value);
  if (!cleaned) {
    return '';
  }

  const lower = cleaned.trim().toLowerCase();
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('/') ||
    lower.startsWith('#') ||
    lower.startsWith('./') ||
    lower.startsWith('../')
  ) {
    return cleaned;
  }

  return '';
}

/**
 * Props forwarded to the library's default `<a>` renderer. The extra
 * `className` / `node` fields match the shape react-markdown passes to
 * its component map, so pulling the renderer out of the `components`
 * map and calling it directly (as `AgentMessage.test.tsx` does) yields
 * identical output to the in-pipeline render.
 */
type DefaultAnchorRendererProps = HTMLAttributes<HTMLAnchorElement> & {
  href?: string;
  target?: string;
  rel?: string;
  node?: unknown;
};

/**
 * Library-default `<a>` renderer for markdown links. Hoisted out of
 * `AgentMessage`'s component map so the defense-in-depth `rel` injection
 * (below) is directly testable — the current sanitize schema strips
 * `target` before it can reach the renderer through normal markdown
 * input, so the injection only fires when a future schema widening, a
 * bespoke `components.a` override that mimics the default, or a direct
 * call from tests supplies `target="_blank"`. Keeping the logic honest
 * in a named function (rather than an inline arrow inside `useMemo`)
 * means SECURITY.md §3.2 is enforced in one discoverable place.
 */
export function AgentMessageAnchor({
  className: c,
  node: _node,
  target,
  rel,
  ...props
}: DefaultAnchorRendererProps) {
  // When agents autolink to `target="_blank"` we inject
  // `rel="noopener noreferrer"` to close the reverse-tabnabbing hole —
  // a `target="_blank"` link without `noopener` lets the new tab
  // script-control the opener. The existing `rel` tokens survive so
  // consumer-authored metadata (e.g. `rel="ugc"`) isn't dropped.
  const mergedRel = target === '_blank' ? `noopener noreferrer ${rel ?? ''}`.trim() : rel;
  return (
    <a
      {...props}
      target={target}
      rel={mergedRel}
      className={classnames('airo-chat-agent-message__link', c)}
    />
  );
}

/**
 * Props for `AgentMessage`, the AI-authored text response block.
 */
export interface AgentMessageProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /**
   * Markdown source emitted by the agent. Rendered through a hardened
   * `remark` / `rehype` pipeline with GitHub-flavored markdown support
   * (tables, strikethrough, task lists, autolinks) and scoped to the
   * subset of tags styled by this component: paragraphs, headings
   * (`h1`–`h3`), emphasis, inline code, code blocks, links, ordered /
   * unordered lists, blockquotes, and thematic breaks. Unsupported tags
   * and any inline HTML are stripped — the renderer is the only sanctioned
   * way to display agent-authored text in a chat thread.
   */
  children: string;
  /**
   * Accessible name for the live region. Defaults to `"Assistant response"`.
   * Pair with the agent's avatar or turn label so screen-reader users hear
   * a meaningful announcement when new tokens stream in.
   *
   * A native `aria-label` HTML attribute on the root takes precedence for
   * compatibility; otherwise this prop wins.
   */
  ariaLabel?: string;
  /**
   * Optional per-node component overrides forwarded to `react-markdown`.
   *
   * The component applies its own UXCore2-aware defaults first — paragraphs
   * render through `@ux/text`, code blocks through a BEM-scoped `<pre>`,
   * and so on — and merges consumer overrides on top of those defaults. Use
   * this slot sparingly; downstream overrides that ship raw HTML (e.g. a
   * `<div>`) bypass the typography layer, so stay inline-safe when you
   * reach for it.
   *
   * Every override is still subject to the sanitize schema: a custom
   * renderer only runs for tags that survive sanitization (`p`, `ul`, `ol`,
   * `li`, `strong`, `em`, `code`, `pre`, `a`, `blockquote`, `h1`–`h3`,
   * `hr`, `br`).
   */
  components?: Components;
}

/**
 * `AgentMessage` renders agent-authored markdown as a streaming-friendly
 * chat-message block styled with UXCore2 typography. It is purpose-built
 * for text responses from an AI agent — non-text modalities (tool calls,
 * citations, media) are out of scope and should use their own components.
 *
 * The renderer lives **inside** the component rather than behind a consumer
 * hook because the sanitization contract is part of the component's
 * security posture: every instance enforces the same allow-list of tags,
 * URL schemes, and attribute shapes, so model output cannot smuggle
 * scripts, event handlers, opaque CSS, or unsafe links into the product.
 *
 * The root is a polite live region. When the agent streams tokens in,
 * assistive technology announces the newly-added text without re-reading
 * the full response.
 *
 * @example
 * <AgentMessage>
 *   {`**Here are three options** for your landing page:\n\n` +
 *    `- A hero with a product shot\n` +
 *    `- A split-column layout with a CTA\n` +
 *    `- A full-bleed video background`}
 * </AgentMessage>
 */
export function AgentMessage({
  children,
  className,
  ariaLabel,
  'aria-label': ariaLabelAttribute,
  components,
  ...rest
}: AgentMessageProps) {
  const defaultComponents = useMemo<Components>(() => {
    return {
      p: ({ className: c, node: _node, ...props }) => (
        <text.p
          {...props}
          as="paragraph"
          className={classnames('airo-chat-agent-message__paragraph', c)}
        />
      ),
      h1: ({ className: c, node: _node, ...props }) => (
        <text.h1
          {...props}
          as="title"
          size={TITLE_SIZE_MAP.h1}
          className={classnames('airo-chat-agent-message__title', c)}
        />
      ),
      h2: ({ className: c, node: _node, ...props }) => (
        <text.h2
          {...props}
          as="title"
          size={TITLE_SIZE_MAP.h2}
          className={classnames('airo-chat-agent-message__title', c)}
        />
      ),
      h3: ({ className: c, node: _node, ...props }) => (
        <text.h3
          {...props}
          as="title"
          size={TITLE_SIZE_MAP.h3}
          className={classnames('airo-chat-agent-message__title', c)}
        />
      ),
      strong: ({ className: c, node: _node, ...props }) => (
        <text.strong {...props} className={classnames('airo-chat-agent-message__strong', c)} />
      ),
      em: ({ className: c, node: _node, ...props }) => (
        <em
          {...(props as HTMLAttributes<HTMLElement>)}
          className={classnames('airo-chat-agent-message__em', c)}
        />
      ),
      a: AgentMessageAnchor,
      ul: ({ className: c, node: _node, ...props }) => (
        <ul {...props} className={classnames('airo-chat-agent-message__list', c)} />
      ),
      ol: ({ className: c, node: _node, ...props }) => (
        <ol
          {...props}
          className={classnames(
            'airo-chat-agent-message__list',
            'airo-chat-agent-message__list--ordered',
            c,
          )}
        />
      ),
      li: ({ className: c, node: _node, ...props }) => (
        <li {...props} className={classnames('airo-chat-agent-message__list-item', c)} />
      ),
      blockquote: ({ className: c, node: _node, ...props }) => (
        <blockquote {...props} className={classnames('airo-chat-agent-message__blockquote', c)} />
      ),
      code: ({ className: c, node: _node, ...props }) => (
        <code {...props} className={classnames('airo-chat-agent-message__code', c)} />
      ),
      // Fenced code blocks arrive here as `<pre>` wrapping the `<code>`
      // element already produced by the `code` renderer above. Rather than
      // emit our own `<pre>` shell, we pull the inner code's language class
      // and raw source out of the child and route the block through
      // `@ux/code`, which runs Prism.JS over the source and applies the
      // theme's `uxCode.*` intents for the block background, font, and
      // token colors. Unknown languages render as plain monospace — Prism
      // no-ops when it has no grammar — so this is graceful for anything
      // that ships outside the default Prism bundle.
      //
      // `@ux/code` spreads `className` onto its inner `<code>` (where
      // Prism looks for the grammar), and hard-codes `.ux-code` on the
      // outer `<pre>`. That's why we forward *only* the language token
      // here — our block-level styling (border-radius, margin reset, etc.)
      // is scoped via `.airo-chat-agent-message .ux-code` in styles.css.
      pre: ({ className: _c, node: _node, children, ..._props }) => {
        if (isValidElement(children)) {
          const childProps = children.props as {
            className?: string;
            children?: ReactNode;
          };
          const raw = childProps.children;
          if (typeof raw === 'string') {
            return (
              <Code className={extractLanguageClass(childProps.className)}>
                {/* Trim the trailing newline `remark` leaves on every fenced
                    block so Prism doesn't render an empty last line. */}
                {raw.replace(/\n$/, '')}
              </Code>
            );
          }
        }
        // Fallback for the rare case where the inner node isn't a plain
        // string (e.g. a consumer-override mutates the tree mid-render).
        // Emits an unstyled `<pre>` so the content is at least readable.
        return <pre className="airo-chat-agent-message__code-block">{children}</pre>;
      },
      hr: ({ className: c, node: _node, ...props }) => (
        <hr {...props} className={classnames('airo-chat-agent-message__hr', c)} />
      ),
    };
  }, []);

  const mergedComponents = useMemo<Components>(
    () => (components ? { ...defaultComponents, ...components } : defaultComponents),
    [defaultComponents, components],
  );

  const accessibleName = ariaLabelAttribute ?? ariaLabel ?? DEFAULT_ARIA_LABEL;

  return (
    // `box.article` keeps the semantic `<article>` landmark but gives us a
    // flex container so `gap="sm"` applies a consistent UXCore2-scaled gap
    // between the markdown block children (paragraphs, headings, lists,
    // code blocks, blockquotes, rules) without needing margin-based rhythm.
    // `react-markdown` renders its output into a React fragment, so the
    // markdown elements become direct flex children of the article.
    <box.article
      {...rest}
      orientation="vertical"
      gap="sm"
      aria-live="polite"
      aria-atomic="false"
      aria-label={accessibleName}
      className={classnames('airo-chat-agent-message', className)}
    >
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={safeUrlTransform}
        components={mergedComponents}
        skipHtml
      >
        {children}
      </Markdown>
    </box.article>
  );
}

// Plugin arrays are hoisted so every render passes the **same** references to
// `react-markdown`, skipping its internal "did the plugins change?" revalidation
// and keeping the unified processor cached between re-renders.
const REMARK_PLUGINS: PluggableList = [remarkGfm];
const REHYPE_PLUGINS: PluggableList = [[rehypeSanitize, agentMessageSanitizeSchema]];
