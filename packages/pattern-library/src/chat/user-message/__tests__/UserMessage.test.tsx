/* eslint-disable no-script-url -- this file tests that the URL guard rejects javascript: / data: / file: schemes; constructing those inputs is the test. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { resolveFileIcon } from '../UserMessageFile';
import { UserMessage, isSafeHref, isSafeImgSrc } from '../index';

beforeAll(() => {
  // `@ux/icon/async-icon.js` lazily fetches its SVG from an asset server.
  // In jsdom we return an empty SVG so the fetch resolves synchronously and
  // the component tree never throws.
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;

    if (url.includes('/ux-assets/@ux/icon/')) {
      return Promise.resolve(
        new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        }),
      );
    }

    return Promise.reject(new Error(`Unexpected fetch in UserMessage tests: ${url}`));
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('UserMessage', () => {
  describe('root', () => {
    it('renders as an article landmark with the default accessible name', () => {
      render(<UserMessage>Hello.</UserMessage>);
      expect(screen.getByRole('article', { name: 'You said' })).toBeInTheDocument();
    });

    it('lets ariaLabel override the default accessible name', () => {
      render(<UserMessage ariaLabel="Your turn">Hello.</UserMessage>);
      expect(screen.getByRole('article', { name: 'Your turn' })).toBeInTheDocument();
    });

    it('lets a native aria-label attribute take precedence over ariaLabel', () => {
      render(
        <UserMessage ariaLabel="Localized" aria-label="Explicit override">
          Hello.
        </UserMessage>,
      );
      expect(screen.getByRole('article', { name: 'Explicit override' })).toBeInTheDocument();
    });

    it('forwards className and data-* attributes to the root', () => {
      const { container } = render(
        <UserMessage className="custom" data-testid="user-root">
          Hello.
        </UserMessage>,
      );
      const root = container.querySelector('.airo-chat-user-message');
      expect(root).toHaveClass('airo-chat-user-message', 'custom');
      expect(root).toHaveAttribute('data-testid', 'user-root');
    });

    it('renders a plain-string child as a single @ux/text paragraph', () => {
      const { container } = render(<UserMessage>Plain.</UserMessage>);
      const paragraph = container.querySelector('.airo-chat-user-message__text');
      expect(paragraph).not.toBeNull();
      expect(paragraph?.textContent).toBe('Plain.');
    });

    it('passes a React-node child through unchanged', () => {
      render(
        <UserMessage>
          <span data-testid="custom-child">Nested.</span>
        </UserMessage>,
      );
      expect(screen.getByTestId('custom-child')).toBeInTheDocument();
    });
  });

  describe('bubble surface', () => {
    it('squares the block-end / inline-end corner via the bubble class', () => {
      const { container } = render(<UserMessage>Hello.</UserMessage>);
      expect(container.querySelector('.airo-chat-user-message__bubble')).not.toBeNull();
    });

    it('works inside a RTL flow (logical properties mirror automatically)', () => {
      const { container } = render(
        <div dir="rtl">
          <UserMessage>Hello.</UserMessage>
        </div>,
      );
      // The root uses `justify-content: flex-end` (a flex property, not
      // direction-sensitive) and `margin-inline-start: auto`. We cannot
      // read the computed margin reliably in jsdom, so assert the root
      // renders inside a `dir="rtl"` ancestor instead of checking paint.
      const root = container.querySelector('.airo-chat-user-message');
      expect(root?.closest('[dir="rtl"]')).not.toBeNull();
    });
  });

  describe('gallery', () => {
    it('applies the single-item modifier when there is exactly one child', () => {
      const { container } = render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/x.jpg" alt="X" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      expect(container.querySelector('.airo-chat-user-message__gallery--single')).not.toBeNull();
    });

    it('omits the single-item modifier with 2+ children', () => {
      const { container } = render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/a.jpg" alt="A" />
            <UserMessage.Image src="/b.jpg" alt="B" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      expect(container.querySelector('.airo-chat-user-message__gallery--single')).toBeNull();
    });

    it('renders with a default accessible gallery name', () => {
      render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/a.jpg" alt="A" />
          </UserMessage.Gallery>
          text
        </UserMessage>,
      );
      // The group role name defaults to "Attached files".
      expect(screen.getByRole('group', { name: 'Attached files' })).toBeInTheDocument();
    });
  });

  describe('image tile', () => {
    it('renders as an accessible button with the alt text as its name', () => {
      render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/hero.jpg" alt="Hero image" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      expect(screen.getByRole('button', { name: 'Hero image' })).toBeInTheDocument();
    });

    it('opens the lightbox modal when clicked', async () => {
      const user = userEvent.setup();
      render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/hero.jpg" alt="landing-hero.jpg" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      const tile = screen.getByRole('button', { name: 'landing-hero.jpg' });
      await user.click(tile);

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toBeInTheDocument();
      const preview = within(dialog).getByRole('img');
      expect(preview).toHaveAttribute('src', '/hero.jpg');
      expect(preview).toHaveAttribute('alt', 'landing-hero.jpg');
    });

    it('renders the alt as a caption paragraph below the preview (no title row)', async () => {
      const user = userEvent.setup();
      render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/hero.jpg" alt="landing-hero.jpg" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      await user.click(screen.getByRole('button', { name: 'landing-hero.jpg' }));
      const dialog = await screen.findByRole('dialog');

      // Dialog has no heading row — the modal renders the close-button
      // slot only, with the alt text as a paragraph caption beneath the
      // preview. No `heading` role should resolve inside the dialog.
      expect(within(dialog).queryByRole('heading')).toBeNull();

      const caption = within(dialog).getByText('landing-hero.jpg');
      expect(caption.tagName).toBe('P');

      // The caption is the source of the dialog's accessible name —
      // `aria-labelledby` points at the caption's id and the accessible
      // name of the dialog resolves to the caption text.
      const captionId = caption.getAttribute('id');
      expect(captionId).toBeTruthy();
      expect(dialog).toHaveAttribute('aria-labelledby', captionId ?? '');
      expect(dialog).toHaveAccessibleName('landing-hero.jpg');
    });

    it('falls back to a default dialog label when the image has no alt text', async () => {
      const user = userEvent.setup();
      render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/hero.jpg" alt="" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      // Empty `alt` → tile button falls back to its default a11y label.
      await user.click(screen.getByRole('button', { name: /open image preview/i }));
      const dialog = await screen.findByRole('dialog');

      // No caption → no labelledby → `aria-label="Image preview"` carries
      // the dialog's accessible name instead.
      expect(dialog).not.toHaveAttribute('aria-labelledby');
      expect(dialog).toHaveAccessibleName('Image preview');
    });

    it('closes the lightbox when the close button is pressed', async () => {
      const user = userEvent.setup();
      render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/hero.jpg" alt="Hero image" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      await user.click(screen.getByRole('button', { name: 'Hero image' }));
      const dialog = await screen.findByRole('dialog');
      const closeButton = within(dialog).getByRole('button', {
        name: /close image preview/i,
      });
      await user.click(closeButton);

      // Modal unmounts on close; the dialog is no longer in the document.
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('lets the consumer cancel the lightbox via event.preventDefault()', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn((event: React.MouseEvent) => event.preventDefault());
      render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/hero.jpg" alt="Hero image" onClick={onClick} />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      await user.click(screen.getByRole('button', { name: 'Hero image' }));
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('still fires a consumer onClick when the lightbox opens', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/hero.jpg" alt="Hero image" onClick={onClick} />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      await user.click(screen.getByRole('button', { name: 'Hero image' }));
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('file tile (strip layout)', () => {
    it('renders with the filename as the card wrapper aria-label', () => {
      // File-only galleries default to the list layout; pin `layout="strip"`
      // here so we're exercising the Card tile chrome specifically.
      const { container } = render(
        <UserMessage>
          <UserMessage.Gallery layout="strip">
            <UserMessage.File name="requirements.pdf" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      // `@ux/card` applies consumer className to the inner shell but spreads
      // `aria-label` onto the outer wrapper, so assert that the wrapper
      // carrying our shell class descendant has the filename label.
      const shell = container.querySelector('.airo-chat-user-message__file');
      const wrapper = shell?.parentElement;
      expect(wrapper).not.toBeNull();
      expect(wrapper?.getAttribute('aria-label')).toBe('requirements.pdf');
    });

    it('renders as a link when href is set and preserves target/rel safety', () => {
      render(
        <UserMessage>
          <UserMessage.Gallery layout="strip">
            <UserMessage.File
              name="requirements.pdf"
              href="https://example.com/req.pdf"
              target="_blank"
            />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      const link = screen.getByRole('link', { name: 'requirements.pdf' });
      expect(link).toHaveAttribute('href', 'https://example.com/req.pdf');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders the filename caption with the shared BEM class', () => {
      const { container } = render(
        <UserMessage>
          <UserMessage.Gallery layout="strip">
            <UserMessage.File name="notes.md" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      expect(container.querySelector('.airo-chat-user-message__file-name')).toHaveTextContent(
        'notes.md',
      );
    });
  });

  describe('resolveFileIcon', () => {
    it('maps office formats to their branded icons', () => {
      expect(resolveFileIcon('report.docx')).toBe('word');
      expect(resolveFileIcon('budget.xlsx')).toBe('excel');
      expect(resolveFileIcon('pitch.pptx')).toBe('powerpoint');
    });

    it('maps archives, video, and code extensions', () => {
      expect(resolveFileIcon('assets.zip')).toBe('archive');
      expect(resolveFileIcon('demo.mp4')).toBe('video');
      expect(resolveFileIcon('build.sh')).toBe('code');
      expect(resolveFileIcon('tsconfig.json')).toBe('code');
    });

    it('is case-insensitive on the extension', () => {
      expect(resolveFileIcon('READ.ME.DOCX')).toBe('word');
    });

    it('falls back to `attachment` for unknown extensions and bare names', () => {
      expect(resolveFileIcon('requirements.pdf')).toBe('attachment');
      expect(resolveFileIcon('README')).toBe('attachment');
      expect(resolveFileIcon('.hidden')).toBe('attachment');
      expect(resolveFileIcon('trailing.')).toBe('attachment');
    });
  });

  describe('list layout', () => {
    it('auto-switches to the list layout when a file tile is present', () => {
      const { container } = render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/hero.jpg" alt="Hero" />
            <UserMessage.File name="requirements.pdf" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      expect(container.querySelector('.airo-chat-user-message__gallery--list')).not.toBeNull();
      expect(container.querySelector('.airo-chat-user-message__gallery--strip')).toBeNull();
    });

    it('stays in the strip layout for images-only galleries', () => {
      const { container } = render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/a.jpg" alt="A" />
            <UserMessage.Image src="/b.jpg" alt="B" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      expect(container.querySelector('.airo-chat-user-message__gallery--strip')).not.toBeNull();
      expect(container.querySelector('.airo-chat-user-message__gallery--list')).toBeNull();
    });

    it('honors an explicit layout prop over auto-detection', () => {
      const { container } = render(
        <UserMessage>
          <UserMessage.Gallery layout="list">
            <UserMessage.Image src="/a.jpg" alt="A" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      expect(container.querySelector('.airo-chat-user-message__gallery--list')).not.toBeNull();
    });

    it('renders file rows through @ux/list-item with an icon media slot', () => {
      const { container } = render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.File name="requirements.pdf" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      // `@ux/list-item`'s root class is `ux-list-item`; our own marker
      // `__file-list-item` is appended to it.
      expect(container.querySelector('.airo-chat-user-message__file-list-item')).not.toBeNull();
      expect(container.querySelector('.airo-chat-user-message__file-media--icon')).not.toBeNull();
      // The filename stays reachable via the shared caption class.
      expect(
        container.querySelector(
          '.airo-chat-user-message__file-list-item .airo-chat-user-message__file-name',
        ),
      ).toHaveTextContent('requirements.pdf');
    });

    it('renders an image row whose thumbnail still opens the lightbox', async () => {
      const user = userEvent.setup();
      render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/hero.jpg" alt="Hero image" />
            <UserMessage.File name="requirements.pdf" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      // The button sits inside the list-item's media slot and keeps its
      // alt-derived accessible name.
      const thumb = screen.getByRole('button', { name: 'Hero image' });
      await user.click(thumb);
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });

    it('renders a file row with href as an anchor list-item', () => {
      render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.File name="other.zip" />
            <UserMessage.File
              name="requirements.pdf"
              href="https://example.com/req.pdf"
              target="_blank"
            />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      // `@ux/list-item` with `href` renders a real anchor via `box.a`.
      // The accessible name includes the filename; a link role is exposed.
      const link = screen.getByRole('link', { name: /requirements\.pdf/ });
      expect(link).toHaveAttribute('href', 'https://example.com/req.pdf');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('wraps the slats in a single elevation="card" surface', () => {
      // The list layout renders through `<Box elevation="card">` so the
      // stacked slats read as one card. We can't inspect the painted
      // surface in jsdom, but the class map from `@ux/box` is stable:
      // `ux-box--elevation-card` is added whenever `elevation="card"` is
      // set, and the gallery BEM class rides on the same element.
      const { container } = render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.File name="a.pdf" />
            <UserMessage.File name="b.pdf" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      const gallery = container.querySelector('.airo-chat-user-message__gallery--list');
      expect(gallery).not.toBeNull();
      expect(gallery).toHaveClass('ux-box--elevation-card');
    });

    it('keeps the strip layout as a plain div (no card wrapper)', () => {
      // Regression guard: the images-only strip has its own scroll
      // affordance and shouldn't read as a nested card inside the
      // bubble. Verify we did not accidentally apply the card surface
      // to the strip variant as well.
      const { container } = render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.Image src="/a.jpg" alt="A" />
            <UserMessage.Image src="/b.jpg" alt="B" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      const gallery = container.querySelector('.airo-chat-user-message__gallery--strip');
      expect(gallery).not.toBeNull();
      expect(gallery).not.toHaveClass('ux-box--elevation-card');
    });

    // Regression guards for the URL-guard contract. SECURITY.md §3.1 / §3.2
    // require a scheme allow-list on every `src` / `href` built from
    // consumer input. The library ships the default predicates
    // `isSafeImgSrc` / `isSafeHref` and exposes `validateSrc` /
    // `validateHref` props so consumers can tighten or broaden the policy.
    describe('URL guards', () => {
      describe('isSafeImgSrc (default img src predicate)', () => {
        it('accepts http, https, and relative / fragment URLs', () => {
          expect(isSafeImgSrc('https://cdn.example.com/a.jpg')).toBe(true);
          expect(isSafeImgSrc('http://cdn.example.com/a.jpg')).toBe(true);
          expect(isSafeImgSrc('/static/a.jpg')).toBe(true);
          expect(isSafeImgSrc('./a.jpg')).toBe(true);
          expect(isSafeImgSrc('../a.jpg')).toBe(true);
          expect(isSafeImgSrc('#fragment')).toBe(true);
        });

        it('rejects every hostile scheme from SECURITY.md §3.1', () => {
          // Each of these is a known XSS / local-disclosure vector when it
          // reaches an `<img src>` sink.
          expect(isSafeImgSrc('javascript:alert(1)')).toBe(false);
          expect(isSafeImgSrc('JAVASCRIPT:alert(1)')).toBe(false);
          expect(isSafeImgSrc('vbscript:msgbox(1)')).toBe(false);
          expect(isSafeImgSrc('data:text/html,<script>alert(1)</script>')).toBe(false);
          expect(isSafeImgSrc('data:image/svg+xml,<svg/onload=alert(1)>')).toBe(false);
          expect(isSafeImgSrc('file:///etc/passwd')).toBe(false);
          expect(isSafeImgSrc('blob:https://evil.example.com/abc')).toBe(false);
        });
      });

      describe('isSafeHref (default a href predicate)', () => {
        it('accepts http, https, mailto, tel, sms, and relative URLs', () => {
          expect(isSafeHref('https://example.com/file.pdf')).toBe(true);
          expect(isSafeHref('http://example.com/file.pdf')).toBe(true);
          expect(isSafeHref('mailto:support@example.com')).toBe(true);
          expect(isSafeHref('tel:+15551234567')).toBe(true);
          expect(isSafeHref('sms:+15551234567')).toBe(true);
          expect(isSafeHref('/downloads/file.pdf')).toBe(true);
          expect(isSafeHref('#section')).toBe(true);
        });

        it('rejects javascript, vbscript, data, and file schemes', () => {
          expect(isSafeHref('javascript:alert(1)')).toBe(false);
          expect(isSafeHref('vbscript:msgbox(1)')).toBe(false);
          expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
          expect(isSafeHref('file:///etc/passwd')).toBe(false);
          expect(isSafeHref('')).toBe(false);
        });
      });

      describe('UserMessage.Image src guard', () => {
        it('does not render an <img> sink for a javascript: src', () => {
          const { container } = render(
            <UserMessage>
              <UserMessage.Gallery>
                <UserMessage.Image src="javascript:alert(1)" alt="hostile.png" />
              </UserMessage.Gallery>
            </UserMessage>,
          );
          // Tile button still renders (keeps gallery layout, keeps the
          // filename accessible name), but no `<img>` points at the
          // hostile URL.
          const button = screen.getByRole('button', { name: 'hostile.png' });
          expect(button).toBeInTheDocument();
          expect(container.querySelector('img')).toBeNull();
          // Unsafe-scheme placeholder takes the image's slot.
          expect(
            container.querySelector('.airo-chat-user-message__image-img--unsafe'),
          ).not.toBeNull();
        });

        it('disables the lightbox trigger when the src fails validation', async () => {
          const user = userEvent.setup();
          render(
            <UserMessage>
              <UserMessage.Gallery>
                <UserMessage.Image src="data:text/html,<script>alert(1)</script>" alt="x" />
              </UserMessage.Gallery>
            </UserMessage>,
          );
          const button = screen.getByRole('button', { name: 'x' });
          // The button is marked disabled so AT announces it as such and
          // clicks are a no-op; no dialog should open.
          expect(button).toBeDisabled();
          await user.click(button);
          expect(screen.queryByRole('dialog')).toBeNull();
        });

        it('lets a consumer-provided validateSrc widen the default policy', async () => {
          const user = userEvent.setup();
          // Allow the library default PLUS known-safe `data:image/svg+xml`
          // that this app's SVG factory generates. This is the canonical
          // "we set the default, consumer owns the final policy" path.
          const validateSrc = (src: string) =>
            isSafeImgSrc(src) || src.startsWith('data:image/svg+xml;utf8,');
          render(
            <UserMessage validateSrc={validateSrc}>
              <UserMessage.Gallery>
                <UserMessage.Image
                  src={'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>'}
                  alt="generated.svg"
                />
              </UserMessage.Gallery>
            </UserMessage>,
          );
          const button = screen.getByRole('button', { name: 'generated.svg' });
          expect(button).not.toBeDisabled();
          await user.click(button);
          expect(await screen.findByRole('dialog')).toBeInTheDocument();
        });

        it('honors a per-tile validateSrc override over the root policy', () => {
          // Root policy accepts everything (terrible idea in prod, useful
          // in a test). Per-tile override on the second image pins it back
          // to the library default, so its hostile src is dropped even
          // though the sibling's passes.
          const { container } = render(
            <UserMessage validateSrc={() => true}>
              <UserMessage.Gallery>
                <UserMessage.Image src="https://cdn.example.com/a.jpg" alt="safe" />
                <UserMessage.Image
                  src="javascript:alert(1)"
                  alt="hostile"
                  validateSrc={isSafeImgSrc}
                />
              </UserMessage.Gallery>
            </UserMessage>,
          );
          const imgs = container.querySelectorAll('img');
          // Only the first (safe) tile should have mounted an <img>.
          expect(imgs.length).toBe(1);
          expect(imgs[0]).toHaveAttribute('src', 'https://cdn.example.com/a.jpg');
        });
      });

      describe('UserMessage.File href guard', () => {
        it('drops an unsafe href and renders the filename as plain text (strip layout)', () => {
          const { container } = render(
            <UserMessage>
              <UserMessage.Gallery layout="strip">
                <UserMessage.File name="hostile.pdf" href="javascript:alert(1)" />
              </UserMessage.Gallery>
            </UserMessage>,
          );
          expect(container.querySelector('a')).toBeNull();
          expect(container.querySelector('.airo-chat-user-message__file-name')).toHaveTextContent(
            'hostile.pdf',
          );
        });

        it('drops an unsafe href on a list-layout file row', () => {
          render(
            <UserMessage>
              <UserMessage.Gallery>
                <UserMessage.File name="other.zip" />
                <UserMessage.File name="hostile.pdf" href="vbscript:msgbox(1)" target="_blank" />
              </UserMessage.Gallery>
            </UserMessage>,
          );
          // No link role surfaces for the hostile row; the filename still
          // reads, but click-through is suppressed.
          expect(screen.queryByRole('link', { name: /hostile\.pdf/ })).toBeNull();
          expect(screen.getByText('hostile.pdf')).toBeInTheDocument();
        });

        it('lets a consumer-provided validateHref tighten the default policy', () => {
          const sameOriginOnly = (value: string) => {
            try {
              const url = new URL(value, 'https://app.example.com/');
              return url.origin === 'https://app.example.com';
            } catch {
              return false;
            }
          };
          render(
            <UserMessage validateHref={sameOriginOnly}>
              <UserMessage.Gallery layout="strip">
                <UserMessage.File name="external.pdf" href="https://evil.example.com/x.pdf" />
              </UserMessage.Gallery>
            </UserMessage>,
          );
          // Cross-origin href is filtered out despite being a "safe" scheme
          // under the library default — consumer policy wins.
          expect(screen.queryByRole('link', { name: /external\.pdf/ })).toBeNull();
        });
      });
    });

    it('renders list-mode rows through the compact list-item variant', () => {
      // `@ux/list-item` reads `compact` into the row's space tokens:
      // `inlinePadding={ compact ? 'md' : 'lg' }`,
      // `blockPadding={ compact ? 'sm' : 'md' }`,
      // `gap={ compact ? 'sm' : 'md' }`. Those props pass through to
      // `@ux/space`, which emits `ux-space--inline-md`,
      // `ux-space--block-sm`, and `ux-space--gap-sm` on the row root.
      // Assert the compact trio is present so a future refactor that
      // drops the prop fails loudly instead of silently reverting to
      // the non-compact spacing.
      const { container } = render(
        <UserMessage>
          <UserMessage.Gallery>
            <UserMessage.File name="notes.md" />
          </UserMessage.Gallery>
        </UserMessage>,
      );
      const row = container.querySelector('.airo-chat-user-message__file-list-item');
      expect(row).not.toBeNull();
      expect(row).toHaveClass(
        'ux-list-item',
        'ux-space--inline-md',
        'ux-space--block-sm',
        'ux-space--gap-sm',
      );
    });
  });
});
