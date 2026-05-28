/* eslint-disable no-script-url -- this file tests that the URL guard rejects javascript: schemes; constructing those inputs is the test. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentMessageAnchor } from '../AgentMessage';
import { AgentMessage } from '../index';

describe('AgentMessage', () => {
  describe('live region', () => {
    it('renders a polite, non-atomic article by default', () => {
      const { container } = render(<AgentMessage>Hello.</AgentMessage>);
      const root = container.querySelector('.airo-chat-agent-message');
      expect(root).not.toBeNull();
      expect(root?.tagName).toBe('ARTICLE');
      expect(root).toHaveAttribute('aria-live', 'polite');
      expect(root).toHaveAttribute('aria-atomic', 'false');
      expect(root).toHaveAttribute('aria-label', 'Assistant response');
    });

    it('lets ariaLabel override the default accessible name', () => {
      const { container } = render(<AgentMessage ariaLabel="Drafting ideas">Hello.</AgentMessage>);
      const root = container.querySelector('.airo-chat-agent-message');
      expect(root).toHaveAttribute('aria-label', 'Drafting ideas');
    });

    it('lets a native aria-label attribute take precedence over ariaLabel', () => {
      const { container } = render(
        <AgentMessage ariaLabel="Localized name" aria-label="Explicit override">
          Hello.
        </AgentMessage>,
      );
      const root = container.querySelector('.airo-chat-agent-message');
      expect(root).toHaveAttribute('aria-label', 'Explicit override');
    });

    it('forwards className and arbitrary data-* attributes', () => {
      const { container } = render(
        <AgentMessage className="custom" data-testid="agent-root">
          Hello.
        </AgentMessage>,
      );
      const root = container.querySelector('.airo-chat-agent-message');
      expect(root).toHaveClass('airo-chat-agent-message', 'custom');
      expect(root).toHaveAttribute('data-testid', 'agent-root');
    });
  });

  describe('markdown rendering', () => {
    it('renders paragraphs through @ux/text', () => {
      const { container } = render(<AgentMessage>Hello there.</AgentMessage>);
      const paragraph = container.querySelector('.airo-chat-agent-message__paragraph');
      expect(paragraph?.textContent).toBe('Hello there.');
    });

    it('renders bold and italic with BEM classes', () => {
      const { container } = render(<AgentMessage>{'**bold** and _italic_'}</AgentMessage>);
      expect(container.querySelector('.airo-chat-agent-message__strong')?.textContent).toBe('bold');
      expect(container.querySelector('.airo-chat-agent-message__em')?.textContent).toBe('italic');
    });

    it('renders h1–h3 through the title proxy', () => {
      const { container } = render(<AgentMessage>{'# One\n\n## Two\n\n### Three'}</AgentMessage>);
      const titles = Array.from(container.querySelectorAll('.airo-chat-agent-message__title'));
      expect(titles.length).toBe(3);
      expect(titles[0]?.tagName).toBe('H1');
      expect(titles[1]?.tagName).toBe('H2');
      expect(titles[2]?.tagName).toBe('H3');
    });

    it('renders ordered and unordered lists with the shared list class', () => {
      const { container } = render(
        <AgentMessage>{'- one\n- two\n\n1. first\n2. second'}</AgentMessage>,
      );
      const lists = Array.from(container.querySelectorAll('.airo-chat-agent-message__list'));
      expect(lists.length).toBe(2);
      expect(lists[0]?.tagName).toBe('UL');
      expect(lists[1]?.tagName).toBe('OL');
      expect(lists[1]?.classList.contains('airo-chat-agent-message__list--ordered')).toBe(true);
      const items = container.querySelectorAll('.airo-chat-agent-message__list-item');
      expect(items.length).toBe(4);
    });

    it('renders inline code with its own BEM class', () => {
      const { container } = render(<AgentMessage>{'Use `inline`.'}</AgentMessage>);
      const inlineCode = container.querySelector('.airo-chat-agent-message__code');
      expect(inlineCode).not.toBeNull();
      expect(inlineCode?.tagName).toBe('CODE');
      expect(inlineCode?.textContent).toBe('inline');
    });

    it('routes fenced code blocks through @ux/code with the language class preserved for Prism', () => {
      const source = 'const answer = 42;';
      const { container } = render(
        <AgentMessage>{`\`\`\`javascript\n${source}\n\`\`\``}</AgentMessage>,
      );
      // @ux/code emits `<pre class="ux-code" data-version="…"><code>…</code></pre>`.
      const uxPre = container.querySelector('pre.ux-code');
      expect(uxPre).not.toBeNull();
      expect(uxPre?.getAttribute('data-version')).toBeTruthy();
      const codeEl = uxPre?.querySelector('code');
      expect(codeEl).not.toBeNull();
      // Prism reads `language-<name>` off the `<code>` element.
      expect(codeEl?.classList.contains('language-javascript')).toBe(true);
      // After Prism runs (via useEffect under jsdom) the token text is still
      // present — we only check the text, not the token-span layout, so the
      // assertion survives Prism implementation changes.
      expect(codeEl?.textContent).toContain('const');
      expect(codeEl?.textContent).toContain('42');
    });

    it('renders fenced code blocks without a language through @ux/code (Prism uses its `none` grammar)', () => {
      const { container } = render(<AgentMessage>{'```\nplain\n```'}</AgentMessage>);
      const uxPre = container.querySelector('pre.ux-code');
      expect(uxPre).not.toBeNull();
      const codeEl = uxPre?.querySelector('code');
      expect(codeEl).not.toBeNull();
      expect(codeEl?.textContent).toContain('plain');
      // When the fence omits a language tag, Prism stamps `language-none` on
      // the element as its "unknown grammar" fallback. Either no language
      // class (from react-markdown) or the `language-none` fallback (from
      // Prism) is acceptable — both mean "no highlighting applied".
      const classes = Array.from(codeEl?.classList ?? []);
      const languageTokens = classes.filter((c) => c.startsWith('language-'));
      if (languageTokens.length > 0) {
        expect(languageTokens).toEqual(['language-none']);
      }
    });

    it('drops non language-* class tokens on <code> before Prism sees them', () => {
      // An agent could try to smuggle one of our own BEM classes through the
      // language slot to spoof styling. The sanitize schema only keeps class
      // tokens that match `^language-[\w+#-]+$`, so the attack class is gone.
      const { container } = render(<AgentMessage>{'```js\nokay\n```'}</AgentMessage>);
      const codeEl = container.querySelector('pre.ux-code code');
      const classes = Array.from(codeEl?.classList ?? []);
      // Only the language token remains.
      expect(classes).toEqual(['language-js']);
    });

    it('renders blockquotes with the accent class', () => {
      const { container } = render(<AgentMessage>{'> aside'}</AgentMessage>);
      expect(container.querySelector('.airo-chat-agent-message__blockquote')).not.toBeNull();
    });

    it('renders GFM tables as sanitized (tables outside allow-list)', () => {
      const { container } = render(
        <AgentMessage>{'| a | b |\n| - | - |\n| 1 | 2 |'}</AgentMessage>,
      );
      // tables are stripped by the sanitize schema; content survives as text.
      expect(container.querySelector('table')).toBeNull();
    });
  });

  describe('security', () => {
    it('strips <script> tags (no executable <script> element is mounted)', () => {
      // `skipHtml` means inline HTML tags in the markdown stream are treated as
      // plain text — the literal "alert('xss')" shows up as a text node but no
      // `<script>` element is added to the DOM, so nothing executes.
      const { container } = render(
        <AgentMessage>{`Before <script>alert('xss')</script> after.`}</AgentMessage>,
      );
      expect(container.querySelector('script')).toBeNull();
    });

    it('strips event handlers on allowed elements', () => {
      const { container } = render(
        <AgentMessage>{'[link](https://example.com "x" onmouseover="alert(1)")'}</AgentMessage>,
      );
      const link = container.querySelector('a');
      expect(link?.getAttribute('onmouseover')).toBeNull();
      expect(link?.getAttribute('onMouseOver')).toBeNull();
    });

    it('strips javascript: URLs from links', () => {
      const { container } = render(
        <AgentMessage>{`[click](javascript:alert('xss'))`}</AgentMessage>,
      );
      const link = container.querySelector('a');
      // Either the link has no href or has an empty one — never the unsafe scheme.
      expect(link?.getAttribute('href') ?? '').not.toContain('javascript:');
    });

    it('strips data: URLs from links', () => {
      const { container } = render(
        <AgentMessage>{`[click](data:text/html,<script>alert('xss')</script>)`}</AgentMessage>,
      );
      const link = container.querySelector('a');
      expect(link?.getAttribute('href') ?? '').not.toContain('data:');
    });

    it('strips tel: URLs from links (allow-list is http/https/mailto only)', () => {
      const { container } = render(<AgentMessage>{'[call](tel:+15551234567)'}</AgentMessage>);
      const link = container.querySelector('a');
      expect(link?.getAttribute('href') ?? '').not.toContain('tel:');
    });

    it('injects rel="noopener noreferrer" when target="_blank" reaches the default anchor renderer', () => {
      // SECURITY.md §3.2 mandates both `noopener` AND `noreferrer` whenever
      // `target="_blank"` is applied to a link — `noopener` closes the
      // reverse-tabnabbing hole, `noreferrer` prevents Referer leakage to
      // the new tab. The sanitize schema today strips `target` from `<a>`
      // before it can reach the default renderer via markdown, so this
      // injection is defense-in-depth: it fires if the schema is ever
      // widened, or if the renderer is reused outside the AgentMessage
      // pipeline (e.g. a consumer passes it as their `components.a` in a
      // different MDX surface).
      //
      // To exercise that code path honestly, call the module-level
      // `AgentMessageAnchor` directly with a controlled `target` — that's
      // the same function `AgentMessage` installs into the component map.
      const { container } = render(
        <AgentMessageAnchor href="https://example.com" target="_blank">
          Example
        </AgentMessageAnchor>,
      );
      const link = container.querySelector('a');
      const relTokens = (link?.getAttribute('rel') ?? '').split(/\s+/);
      expect(link?.getAttribute('target')).toBe('_blank');
      expect(relTokens).toContain('noopener');
      expect(relTokens).toContain('noreferrer');
    });

    it('preserves existing rel tokens when injecting the _blank safety pair', () => {
      // An author-authored `rel="ugc"` (common on agent-emitted links to
      // external third-party content) should survive the injection — we
      // append `noopener noreferrer` rather than overwrite.
      const { container } = render(
        <AgentMessageAnchor href="https://example.com" target="_blank" rel="ugc">
          Example
        </AgentMessageAnchor>,
      );
      const relTokens = (container.querySelector('a')?.getAttribute('rel') ?? '').split(/\s+/);
      expect(relTokens).toContain('ugc');
      expect(relTokens).toContain('noopener');
      expect(relTokens).toContain('noreferrer');
    });

    it('does not add rel when target is not _blank', () => {
      // The injection is scoped to the tabnabbing threat — a link with no
      // `target` (or `target="_self"`) shouldn't get synthetic `rel`
      // tokens, because they'd be misleading noise.
      const { container } = render(
        <AgentMessageAnchor href="https://example.com">Example</AgentMessageAnchor>,
      );
      expect(container.querySelector('a')?.getAttribute('rel')).toBeNull();
    });

    it('ignores inline HTML (skipHtml)', () => {
      const { container } = render(
        <AgentMessage>{'<img src="x" onerror="alert(1)" />'}</AgentMessage>,
      );
      expect(container.querySelector('img')).toBeNull();
    });
  });

  describe('extensibility', () => {
    it('accepts consumer-provided component overrides', () => {
      render(
        <AgentMessage
          components={{
            p: ({ children }) => <p data-testid="custom-paragraph">{children}</p>,
          }}
        >
          Hello.
        </AgentMessage>,
      );
      expect(screen.getByTestId('custom-paragraph')).toHaveTextContent('Hello.');
    });
  });
});
