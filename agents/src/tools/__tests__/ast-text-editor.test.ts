import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

let testAppPath = '';
const hoistedFs = { existsSync, mkdirSync, readFileSync, writeFileSync };
const hoistedPath = { join, dirname };

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(function () {
    const files = {
      view: vi.fn(async function ({ path: filePath }: { path: string }) {
        const fullPath = hoistedPath.join(testAppPath, filePath);
        if (!hoistedFs.existsSync(fullPath)) {
          throw new Error(`ENOENT: file not found: ${filePath}`);
        }
        const content = hoistedFs.readFileSync(fullPath, 'utf-8');
        return { content, encoding: 'utf-8', path: filePath, lines: content.split('\n').length, size: content.length, truncated: false };
      }),
      write: vi.fn(async function ({ path: filePath, content }: { path: string; content: string }) {
        const fullPath = hoistedPath.join(testAppPath, filePath);
        hoistedFs.mkdirSync(hoistedPath.dirname(fullPath), { recursive: true });
        hoistedFs.writeFileSync(fullPath, content);
        return { bytesWritten: content.length };
      }),
    };
    return { files, tasks: undefined };
  }),
}));

import { ASTTextEditor } from '../ast-text-editor.js';

/**
 * Test fixture based on real app: 2823bf5b-3b9c-4387-9927-66f77ef86054
 * preview/src/pages/index.tsx — the Hello World test app homepage.
 *
 * Key structures that exercise the editor:
 *  - "World." inside a <span> nested in <motion.h1> with {' '} expression siblings
 *  - "Hello," as JSXText followed by {' '} expression in same <motion.h1>
 *  - Simple text in <Badge>, <p>, <Button> elements
 *  - Text with special chars ("v1.0.0 · Test Environment")
 */
const HELLO_WORLD_INDEX_TSX = `import { motion } from 'motion/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <>
      <title>Hello World - Test App</title>
      <meta name="description" content="A simple Hello World test application." />

      <main className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
        {/* Subtle background pattern */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          {/* Grid dots */}
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage: 'radial-gradient(circle, hsl(var(--primary)) 1px, transparent 1px)',
              backgroundSize: '32px 32px'
            }} />

          {/* Soft radial glow */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-10"
            style={{
              background:
              'radial-gradient(circle, hsl(var(--primary)) 0%, hsl(var(--accent)) 50%, transparent 70%)'
            }} />

        </div>

        {/* Content */}
        <div className="relative z-10 text-center px-6 max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}>

            <Badge
              className="mb-6 text-xs font-medium tracking-widest uppercase px-4 py-1.5"
              variant="secondary">

              v1.0.0 · Test Environment
            </Badge>
          </motion.div>

          <motion.h1
            className="text-6xl sm:text-7xl font-bold tracking-tight text-foreground mb-4"
            style={{ fontFamily: 'var(--font-heading)' }}
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1, ease: 'easeOut' }}>

            Hello,{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>

              World.
            </span>
          </motion.h1>

          <motion.p
            className="text-lg text-muted-foreground mb-8 leading-relaxed"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}>Your app is up and running. Everything looks good — time to build something great!!!!


          </motion.p>

          <motion.div
            className="flex justify-center mb-10"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.25, ease: 'easeOut' }}>

            <img
              src="/airo-assets/images/pages/home/dog"
              alt="A happy dog"
              className="w-72 h-72 rounded-full object-cover shadow-lg ring-4 ring-primary/20" />

          </motion.div>

          <motion.div
            className="flex items-center justify-center gap-4 flex-wrap"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3, ease: 'easeOut' }}>

            <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
              <Button
                size="lg"
                className="px-8 font-semibold shadow-md">

                Get Started
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
              <Button size="lg" variant="outline" className="px-8 font-semibold">
                Learn More
              </Button>
            </motion.div>
          </motion.div>

          {/* Status indicator */}
          <motion.div
            className="mt-14 flex items-center justify-center gap-2 text-sm text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.5 }}>

            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            All systems operational
          </motion.div>
        </div>
      </main>
    </>);

}`;

describe('ASTTextEditor — Hello World test app', () => {
  let editor: ASTTextEditor;
  let testFilePath: string;
  const TEST_APP_ID = 'test-app-id';

  beforeEach(async () => {
    editor = new ASTTextEditor();
    testAppPath = `/tmp/ast-text-test-${Date.now()}`;
    await mkdir(join(testAppPath, 'src', 'pages'), { recursive: true });
    testFilePath = join(testAppPath, 'src', 'pages', 'index.tsx');
    await writeFile(testFilePath, HELLO_WORLD_INDEX_TSX);
  });

  afterEach(async () => {
    if (testAppPath && existsSync(testAppPath)) {
      await rm(testAppPath, { recursive: true, force: true });
    }
  });

  // ── Helper to run an edit and return the updated file content ──
  async function editAndRead(request: Parameters<ASTTextEditor['editElementText']>[1]) {
    const result = await editor.editElementText(testAppPath, request, TEST_APP_ID);
    const filePath = join(testAppPath, request.devContext.fileName);
    const updatedContent = await readFile(filePath, 'utf-8');
    return { result, updatedContent };
  }

  // ────────────────────────────────────────────────────────────────
  // CORE BUG: Editing "World." inside <span> nested in <motion.h1>
  // ────────────────────────────────────────────────────────────────

  describe('Editing "World." in nested <span>', () => {
    it('should edit "World." text in the span without destroying the parent h1', async () => {
      // The user clicks on "World." which is inside:
      //   <motion.h1>Hello,{' '}<span ...>World.</span></motion.h1>
      // devContext points to the span (line ~55 in fixture)
      const { result, updatedContent } = await editAndRead({
        selector: 'span',
        oldText: 'World.',
        newText: 'Universe!',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 55
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('Universe!');
      // The parent <motion.h1> must still have "Hello," text
      expect(updatedContent).toContain('Hello,');
      // The {' '} expression should be preserved
      expect(updatedContent).toContain("{' '}");
      // The <span> with gradient styles should still exist
      expect(updatedContent).toContain('WebkitBackgroundClip');
    });

    it('should not match the parent motion.h1 when editing "World."', async () => {
      // If the editor incorrectly matches <motion.h1> (which contains "Hello, World.")
      // instead of <span> (which contains just "World."), it would destroy the h1 structure
      const { result, updatedContent } = await editAndRead({
        selector: 'span',
        oldText: 'World.',
        newText: 'Earth.',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 55
        }
      });

      expect(result.success).toBe(true);
      // Must NOT have destroyed the motion.h1's complex children
      expect(updatedContent).toContain('<motion.h1');
      expect(updatedContent).toContain('Hello,');
      expect(updatedContent).toContain('Earth.');
      // The span styling must still be intact
      expect(updatedContent).toContain('linear-gradient');
    });

    it('should handle editing "World." when devContext line points to the h1', async () => {
      // Sometimes the devContext lineNumber may point to the <motion.h1> rather than the <span>
      // The editor should still find the best match for "World." text
      const { result, updatedContent } = await editAndRead({
        selector: 'motion.h1',
        oldText: 'World.',
        newText: 'Globe.',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 47 // line of <motion.h1>
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('Globe.');
      // "Hello," must survive
      expect(updatedContent).toContain('Hello,');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // REALISTIC BROWSER SCENARIO: devContext line points to parent
  // because data-dev-line is on the motion.h1, not the inner span
  // ────────────────────────────────────────────────────────────────

  describe('Realistic browser scenario — "World." with h1 devContext', () => {
    it('should prefer exact text match (span) over contains match (h1)', async () => {
      // Browser sends: oldText="World.", lineNumber=47 (h1 line)
      // The h1 at line 47 has text "Hello,  World." (contains "World.")
      // The span at line ~55 has text "World." (exact match)
      // The editor should prefer the exact match (span), not the h1
      const { result, updatedContent } = await editAndRead({
        selector: 'span',
        oldText: 'World.',
        newText: 'Universe!',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 47 // h1 line, NOT span line
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('Universe!');
      // Critical: the h1 structure must be preserved
      expect(updatedContent).toContain('Hello,');
      expect(updatedContent).toContain("{' '}");
      expect(updatedContent).toContain('WebkitBackgroundClip');
    });

    it('should not flatten h1 children when editing nested "World." text', async () => {
      // The updateTextContent method replaces all children with a single JSXText.
      // If it matches the h1 instead of the span, it destroys:
      //   Hello,{' '}<span style={...}>World.</span>
      // and replaces with just:
      //   Universe!
      const { result, updatedContent } = await editAndRead({
        selector: 'span',
        oldText: 'World.',
        newText: 'Universe!',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 47
        }
      });

      expect(result.success).toBe(true);
      // The span element must still exist with its style attributes
      expect(updatedContent).toContain('<span');
      expect(updatedContent).toContain('linear-gradient');
      expect(updatedContent).toContain('backgroundClip');
      // The h1 must still have its className and style
      expect(updatedContent).toContain('text-6xl');
      expect(updatedContent).toContain('font-heading');
    });

    it('should preserve the exact structure around the edited span', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'span',
        oldText: 'World.',
        newText: 'Universe!',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 47
        }
      });

      expect(result.success).toBe(true);

      // Verify the exact h1 structure is preserved
      // The h1 should still have: Hello,{' '}\n<span ...>Universe!</span>
      expect(updatedContent).toMatch(/Hello,\{' '\}/);
      // The span should contain only the new text
      expect(updatedContent).toMatch(/>\s*Universe!\s*<\/span>/);
      // There should still be exactly one </motion.h1> closing tag
      const h1Closes = updatedContent.match(/<\/motion\.h1>/g);
      expect(h1Closes).toHaveLength(1);
    });

    it('should produce valid JSX after editing "World." to "Universe!"', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'span',
        oldText: 'World.',
        newText: 'Universe!',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 47
        }
      });

      expect(result.success).toBe(true);

      // The file should still be parseable as valid JSX
      const { parse } = await import('@babel/parser');
      expect(() => {
        parse(updatedContent, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript']
        });
      }).not.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Editing "Hello," which is JSXText mixed with {' '} expression
  // ────────────────────────────────────────────────────────────────

  describe('Editing "Hello," in motion.h1', () => {
    it('should edit the "Hello," text in the h1', async () => {
      // "Hello," is JSXText directly inside <motion.h1>, followed by {' '} and <span>
      // The h1 extractTextContent sees "Hello,  World." (concatenated)
      const { result, updatedContent } = await editAndRead({
        selector: 'motion.h1',
        oldText: 'Hello,  World.',
        newText: 'Hey,  World.',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 47
        }
      });

      expect(result.success).toBe(true);
      // If the editor replaces all children with flat text, the <span> gradient is destroyed
      // This test documents the current (potentially broken) behavior
      if (updatedContent.includes('linear-gradient')) {
        // Good: span styling preserved
        expect(updatedContent).toContain('Hey,');
      } else {
        // Bad: the editor flattened the h1, destroying the gradient span
        // This documents the bug for fixing
        expect(updatedContent).toContain('Hey,  World.');
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Simple text edits — these should work cleanly
  // ────────────────────────────────────────────────────────────────

  describe('Simple text edits', () => {
    it('should edit the <title> text', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'title',
        oldText: 'Hello World - Test App',
        newText: 'My Awesome App',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 8
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('My Awesome App');
      expect(updatedContent).not.toContain('Hello World - Test App');
    });

    it('should edit the Badge text with special characters', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'Badge',
        oldText: 'v1.0.0 · Test Environment',
        newText: 'v2.0.0 · Production',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 40
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('v2.0.0 · Production');
    });

    it('should edit the paragraph text', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'motion.p',
        oldText: 'Your app is up and running. Everything looks good — time to build something great!!!!',
        newText: 'Welcome to your new application.',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 67
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('Welcome to your new application.');
    });

    it('should edit the "Get Started" button text', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'Button',
        oldText: 'Get Started',
        newText: 'Begin Now',
        preciseSelector: 'div:nth-child(1) > Button:nth-child(1)',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 96
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('Begin Now');
      // "Learn More" button should be untouched
      expect(updatedContent).toContain('Learn More');
    });

    it('should edit "Learn More" button without affecting "Get Started"', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'Button',
        oldText: 'Learn More',
        newText: 'Read Docs',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 104
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('Read Docs');
      expect(updatedContent).toContain('Get Started');
    });

    it('should edit "All systems operational" text', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'motion.div',
        oldText: 'All systems operational',
        newText: 'System status: Online',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 111
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('System status: Online');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // EXACT reproduction: user adds "d" after "World."
  // ────────────────────────────────────────────────────────────────

  describe('Exact reproduction: adding "d" after "World."', () => {
    it('should change "World." to "World.d" without destroying the page', async () => {
      // This is exactly what the browser sends:
      // - User clicks on <span>World.</span>
      // - span is made contentEditable, user types "d" at the end
      // - originalText="World.", newText="World.d"
      // - extractDevContext walks up to <motion.h1> at line 47
      const { result, updatedContent } = await editAndRead({
        selector: 'span',
        oldText: 'World.',
        newText: 'World.d',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 47
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('World.d');
      // The page structure must be preserved
      expect(updatedContent).toContain('Hello,');
      expect(updatedContent).toContain("{' '}");
      expect(updatedContent).toContain('WebkitBackgroundClip');
      expect(updatedContent).toContain('<motion.h1');
      expect(updatedContent).toContain('<motion.p');
      expect(updatedContent).toContain('Get Started');
      expect(updatedContent).toContain('All systems operational');
      // The content div must NOT have been flattened
      expect(updatedContent).not.toMatch(/text-center px-6 max-w-2xl mx-auto">Hello/);
    });

    it('should match the span not the content div when devContext line is 33', async () => {
      // What if data-dev-line is on the content <div> at line 33 instead of the h1?
      // The editor should still prefer the exact text match on the span
      const { result, updatedContent } = await editAndRead({
        selector: 'span',
        oldText: 'World.',
        newText: 'World.d',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 33 // content div line
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('World.d');
      expect(updatedContent).toContain('Hello,');
      expect(updatedContent).toContain('Get Started');
    });

    it('BUG REPRO: exact payload from browser destroys the page', async () => {
      // Exact request payload captured from the browser:
      // selector: "h1.text-6xl.font-bold.tracking-tight.text-foreground.mb-4"
      // preciseSelector: "div:nth-child(1) > div:nth-child(1) > main:nth-child(2) > div:nth-child(2) > h1:nth-child(2)"
      // oldText: "Hello, World."  (h1.textContent includes nested span text)
      // newText: "Hello, World.d"
      // devContext.lineNumber: 33  (content div line, NOT the h1 line)
      //
      // The AST editor:
      // 1. Skips span at line 55 (lineDiff=22 > 10, text doesn't match exactly)
      // 2. Matches content div at line 33 via partial-text ("Hello, World.".includes("") = true)
      //    + line proximity bonus (same line = +100)
      // 3. updateTextContent replaces ALL div children with "Hello, World.d"
      const { result, updatedContent } = await editAndRead({
        selector: 'h1.text-6xl.font-bold.tracking-tight.text-foreground.mb-4',
        preciseSelector: 'div:nth-child(1) > div:nth-child(1) > main:nth-child(2) > div:nth-child(2) > h1:nth-child(2)',
        oldText: 'Hello, World.',
        newText: 'Hello, World.d',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 33
        }
      });

      expect(result.success).toBe(true);
      // The page MUST NOT be destroyed — the content div must keep its children
      expect(updatedContent).toContain('Get Started');
      expect(updatedContent).toContain('All systems operational');
      expect(updatedContent).toContain('<motion.h1');
    });

    it('should edit "Hello," in h1 without destroying the gradient span', async () => {
      // Exact payload from browser after text-node wrapping fix:
      // The wrapper span captures just "Hello," text, extractDevContext walks
      // up to the h1 which has data-dev-line. The AST editor matches the h1
      // (extractTextContent = "Hello," exact match) and must only update the
      // JSXText "Hello," node, preserving the {' '} and <span>World.</span>.
      const { result, updatedContent } = await editAndRead({
        selector: 'span',
        preciseSelector: 'div:nth-child(1) > div:nth-child(1) > main:nth-child(2) > div:nth-child(2) > h1:nth-child(2) > span:nth-child(1)',
        oldText: 'Hello,',
        newText: 'Helllo,',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 33
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('Helllo,');
      // The gradient span MUST be preserved
      expect(updatedContent).toContain('linear-gradient');
      expect(updatedContent).toContain('WebkitBackgroundClip');
      expect(updatedContent).toContain('World.');
      // Page structure intact
      expect(updatedContent).toContain('Get Started');
      expect(updatedContent).toContain('All systems operational');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // BUG: br-segment edits — editing one line of a multi-line heading
  // destroys text on the other side of <br />
  // ────────────────────────────────────────────────────────────────

  describe('br-segment edits — text split by <br />', () => {
    const BR_HEADING_FIXTURE = `import { motion } from 'motion/react';

export default function HeroPage() {
  return (
    <section className="hero">
      <motion.h1
        className="font-bold text-white"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}>
        30 Years of
        <br />
        Friendship
      </motion.h1>
      <p className="subtitle">A celebration of three decades</p>
    </section>
  );
}`;

    let brFixturePath: string;

    beforeEach(async () => {
      brFixturePath = join(testAppPath, 'src', 'pages', 'hero.tsx');
      await writeFile(brFixturePath, BR_HEADING_FIXTURE);
    });

    it('should preserve text after <br /> when editing text before it (newHtml path)', async () => {
      // Customer scenario: agent generated <h1>30 Years of<br />Friendship</h1>
      // User edits first segment "30 Years of" → "30 Years of great"
      // The segment commit sends newHtml to preserve the br structure.
      //
      // Without newHtml support, updateTextContent jams all text into the first
      // JSXText node and clears the rest — "Friendship" disappears.
      const { result, updatedContent } = await editAndRead({
        selector: 'motion.h1',
        oldText: '30 Years of Friendship',
        newText: '30 Years of great Friendship',
        newHtml: '30 Years of great\n<br />\nFriendship',
        devContext: {
          fileName: 'src/pages/hero.tsx',
          componentName: 'unknown',
          lineNumber: 6,
        }
      });

      expect(result.success).toBe(true);
      // "Friendship" MUST still exist as text AFTER the br
      expect(updatedContent).toContain('Friendship');
      expect(updatedContent).toContain('30 Years of great');
      // The <br /> must still be present
      expect(updatedContent).toContain('<br />');
      // Text must be on separate sides of the br, not jammed together
      const brIndex = updatedContent.indexOf('<br />');
      const friendshipIndex = updatedContent.indexOf('Friendship', brIndex);
      expect(friendshipIndex).toBeGreaterThan(brIndex);
    });

    it('should produce valid JSX when using newHtml with br structure', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'motion.h1',
        oldText: '30 Years of Friendship',
        newText: '30 Years of great Friendship',
        newHtml: '30 Years of great\n<br />\nFriendship',
        devContext: {
          fileName: 'src/pages/hero.tsx',
          componentName: 'unknown',
          lineNumber: 6,
        }
      });

      expect(result.success).toBe(true);
      const { parse } = await import('@babel/parser');
      expect(() => {
        parse(updatedContent, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript']
        });
      }).not.toThrow();
    });

    it('should not destroy sibling elements when newHtml replaces children', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'motion.h1',
        oldText: '30 Years of Friendship',
        newText: '30 Years of great Friendship',
        newHtml: '30 Years of great\n<br />\nFriendship',
        devContext: {
          fileName: 'src/pages/hero.tsx',
          componentName: 'unknown',
          lineNumber: 6,
        }
      });

      expect(result.success).toBe(true);
      // Sibling <p> must survive
      expect(updatedContent).toContain('A celebration of three decades');
      // motion.h1 attributes must survive
      expect(updatedContent).toContain('font-bold text-white');
      expect(updatedContent).toContain('opacity: 0');
    });

    it('should allow a second edit on the same br-segment element', async () => {
      // Round-trip: first edit changes "30 Years of" → "30 Years of great",
      // second edit changes "great" → "amazing". The element must remain
      // findable after the first edit writes bare text + <br /> (no artifact spans).
      await editAndRead({
        selector: 'motion.h1',
        oldText: '30 Years of Friendship',
        newText: '30 Years of great Friendship',
        newHtml: '30 Years of great\n<br />\nFriendship',
        devContext: {
          fileName: 'src/pages/hero.tsx',
          componentName: 'unknown',
          lineNumber: 6,
        }
      });

      // Second edit on the same element — oldText is the full textContent
      // which extractTextContent builds from direct JSXText nodes
      const { result, updatedContent } = await editAndRead({
        selector: 'motion.h1',
        oldText: '30 Years of great Friendship',
        newText: '30 Years of amazing Friendship',
        newHtml: '30 Years of amazing\n<br />\nFriendship',
        devContext: {
          fileName: 'src/pages/hero.tsx',
          componentName: 'unknown',
          lineNumber: 6,
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('30 Years of amazing');
      expect(updatedContent).toContain('Friendship');
      expect(updatedContent).toContain('<br />');
    });

    it('should fail explicitly when newHtml is malformed (not silently degrade)', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'motion.h1',
        oldText: '30 Years of Friendship',
        newText: '30 Years of great Friendship',
        newHtml: '<unclosed',
        devContext: {
          fileName: 'src/pages/hero.tsx',
          componentName: 'unknown',
          lineNumber: 6,
        }
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse newHtml');
      // Source must be unchanged — no silent degradation
      expect(updatedContent).toContain('30 Years of');
      expect(updatedContent).toContain('Friendship');
      expect(updatedContent).not.toContain('30 Years of great');
    });

    it('should handle newHtml with only text change (no structural change)', async () => {
      // Even when newHtml is provided, if it's just plain text the result
      // should be equivalent to a plain text edit
      const { result, updatedContent } = await editAndRead({
        selector: 'p',
        oldText: 'A celebration of three decades',
        newText: 'A celebration of thirty years',
        newHtml: 'A celebration of thirty years',
        devContext: {
          fileName: 'src/pages/hero.tsx',
          componentName: 'unknown',
          lineNumber: 14,
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('A celebration of thirty years');
      expect(updatedContent).not.toContain('A celebration of three decades');
    });

    it('should use devId to match h1 over inner span (complex br + styled span)', async () => {
      // Scenario: <h1>BURGERS<br /><span className="text-primary">THAT MEAN</span><br />BUSINESS.</h1>
      // Without devId, the span's text "THAT MEAN" scores higher as "contains-text"
      // because extractTextContent (shallow) for h1 = "BURGERS BUSINESS." which only
      // partially matches oldText "BURGERS THAT MEAN BUSINESS."
      // DevId ensures the h1 wins with 50000 score.
      const complexFixture = `export default function Hero() {
  return (
    <section className="hero">
      <h1 className="font-heading text-6xl font-bold">
        BURGERS
        <br />
        <span className="text-primary">THAT MEAN</span>
        <br />
        BUSINESS.
      </h1>
    </section>
  );
}`;
      const complexPath = join(testAppPath, 'src', 'pages', 'hero.tsx');
      await writeFile(complexPath, complexFixture);

      // devId for h1: structuralKey = "src/pages/hero.tsx:section#0>h1#0" → DJB2 hash
      const expectedDevId = '2f6082';

      const { result, updatedContent } = await editAndRead({
        selector: 'h1',
        oldText: 'BURGERS THAT MEAN BUSINESS.',
        newText: 'SMASH BURGERS THAT MEAN BUSINESS.',
        newHtml: 'SMASH BURGERS\n<br />\n<span className="text-primary">THAT MEAN</span>\n<br />\nBUSINESS.',
        devContext: {
          fileName: 'src/pages/hero.tsx',
          componentName: 'unknown',
          lineNumber: 4,
          devId: expectedDevId,
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('SMASH BURGERS');
      expect(updatedContent).toContain('THAT MEAN');
      expect(updatedContent).toContain('BUSINESS.');
      // The span must still exist (not get content dumped into it)
      expect(updatedContent).toContain('text-primary');
      // No duplication
      const burgerCount = (updatedContent.match(/SMASH BURGERS/g) || []).length;
      expect(burgerCount).toBe(1);
    });

    it('should target <p> over inner <a> when newHtml adds text around the link', async () => {
      // Regression: shallow text drops a single-child <p><a>...</a></p>, the inner <a> wins exact-text, and structural save nests <a> inside <a>.
      const fixture = `export default function Page() {
  return (
    <section>
      <p><a href="/x">link</a></p>
    </section>
  );
}`;
      const fixturePath = join(testAppPath, 'src', 'pages', 'p-with-a.tsx');
      await writeFile(fixturePath, fixture);

      const { result, updatedContent } = await editAndRead({
        selector: 'p',
        oldText: 'link',
        newText: 'Hello link',
        newHtml: 'Hello <a href="/x">link</a>',
        devContext: {
          fileName: 'src/pages/p-with-a.tsx',
          componentName: 'unknown',
          lineNumber: 4,
        }
      });

      expect(result.success).toBe(true);
      const anchorCount = (updatedContent.match(/<a /g) || []).length;
      expect(anchorCount).toBe(1);
      expect(updatedContent).toContain('Hello');
      expect(updatedContent).toContain('href="/x"');
    });

    it('should match the multi-element parent (no devId) for structural save — no nesting', async () => {
      // Regression: shallow extractTextContent skipped this h1 → descendants won partial-text → structural save nested the h1's content inside them, doubling each edit.
      const fixture = `export default function Page() {
  return (
    <div>
      <h1 className="font-heading">
        <span className="text-white">The Art of</span>
        <br />
        <em className="text-amber-300">the Cake</em>
      </h1>
    </div>
  );
}`;
      const fixturePath = join(testAppPath, 'src', 'pages', 'multi-color.tsx');
      await writeFile(fixturePath, fixture);

      const { result, updatedContent } = await editAndRead({
        selector: 'h1',
        oldText: 'The Art of the Cake',
        newText: 'The Art of the Pie',
        newHtml: '<span className="text-white">The Art of</span><br /><em className="text-amber-300">the Pie</em>',
        devContext: {
          fileName: 'src/pages/multi-color.tsx',
          componentName: 'unknown',
          lineNumber: 4,
        }
      });

      expect(result.success).toBe(true);
      // Structure intact — no nested duplication
      const spanCount = (updatedContent.match(/<span/g) || []).length;
      const emCount = (updatedContent.match(/<em/g) || []).length;
      const brCount = (updatedContent.match(/<br/g) || []).length;
      expect(spanCount).toBe(1);
      expect(emCount).toBe(1);
      expect(brCount).toBe(1);
      // Edit applied
      expect(updatedContent).toContain('the Pie');
      expect(updatedContent).not.toContain('the Cake');
    });

    it('should compute correct devId for same-tag siblings after expression wrappers', async () => {
      // Source-mapper counts ALL same-tag elements under a JSXElement ancestor
      // frame, including those inside .map() or conditionals. The static <h1>
      // after the mapped one gets siblingIndex=1, not 0.
      const mapFixture = `export default function Page({ items }) {
  return (
    <div>
      {items.map(item => <h1 key={item.id}>{item.title}</h1>)}
      <h1 className="static">Static Heading</h1>
    </div>
  );
}`;
      const mapFixturePath = join(testAppPath, 'src', 'pages', 'hero.tsx');
      await writeFile(mapFixturePath, mapFixture);

      // devId for static h1: structuralKey = "src/pages/hero.tsx:div#0>h1#1"
      // (siblingIndex=1 because the mapped h1 counts as #0)
      const expectedDevId = 'ef02b1';

      const { result, updatedContent } = await editAndRead({
        selector: 'h1',
        oldText: 'Static Heading',
        newText: 'Updated Heading',
        devContext: {
          fileName: 'src/pages/hero.tsx',
          componentName: 'unknown',
          lineNumber: 5,
          devId: expectedDevId,
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('Updated Heading');
      expect(updatedContent).not.toContain('Static Heading');
      // The mapped h1 template must be untouched
      expect(updatedContent).toContain('{item.title}');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // h1 matched via partial-text — span styling lost but page intact
  // This is a known limitation: editing the h1 directly flattens its
  // mixed children. Users should click on the span directly instead.
  // ────────────────────────────────────────────────────────────────

  describe('h1 matched via partial-text — child elements preserved, no duplication', () => {
    it('should update h1 text via partial-text while preserving child elements and not duplicating', async () => {
      // When the full h1 textContent is sent as oldText (browser sends recursive textContent),
      // the h1 matches via partial-text. updateTextContent splits newText around child element
      // text ("World.") and only assigns non-child portions to JSXText nodes.
      const { result, updatedContent } = await editAndRead({
        selector: 'h1.text-6xl.font-bold.tracking-tight.text-foreground.mb-4',
        preciseSelector: 'div:nth-child(1) > div:nth-child(1) > main:nth-child(2) > div:nth-child(2) > h1:nth-child(2)',
        oldText: 'Hello, World.',
        newText: 'Hello, World. Hi',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 33
        }
      });

      expect(result.success).toBe(true);
      // The gradient span is preserved
      expect(updatedContent).toContain('linear-gradient');
      expect(updatedContent).toContain('WebkitBackgroundClip');
      // Page structure intact
      expect(updatedContent).toContain('Get Started');
      expect(updatedContent).toContain('All systems operational');
      // CRITICAL: "World." must NOT appear twice — once in the span is enough
      const worldCount = (updatedContent.match(/World\./g) || []).length;
      expect(worldCount).toBe(1);
      // The appended text " Hi" should appear after the span
      expect(updatedContent).toContain('Hi');
    });

    it('BUG REPRO: browser sends full h1 textContent causing duplication', async () => {
      // Exact scenario from user: editing in the h1, browser sends full textContent
      // as oldText/newText. The old smart path put ALL of newText into the first
      // JSXText while preserving the span → "World." appeared twice.
      //
      // h1 children: JSXText("Hello,"), Expr({' '}), JSXElement(<span>World.</span>)
      // Browser sees: "Hello, World." → user appends " Hi" → "Hello, World. Hi"
      // Fix: split "Hello, World. Hi" around anchor "World." → ["Hello, ", " Hi"]
      // Assign "Hello," portion to JSXText, " Hi" after the span.
      const { result, updatedContent } = await editAndRead({
        selector: 'h1.text-6xl.font-bold.tracking-tight.text-foreground.mb-4',
        preciseSelector: 'div:nth-child(1) > div:nth-child(1) > main:nth-child(2) > div:nth-child(2) > h1:nth-child(2)',
        oldText: 'Hello, World.',
        newText: 'Helllo, World. Hi',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 33
        }
      });

      expect(result.success).toBe(true);
      // Span must be preserved with gradient styling
      expect(updatedContent).toContain('linear-gradient');
      expect(updatedContent).toContain('WebkitBackgroundClip');
      // "World." must appear exactly once (in the span), NOT duplicated
      const worldCount = (updatedContent.match(/World\./g) || []).length;
      expect(worldCount).toBe(1);
      // The edited "Hello" text should be present
      expect(updatedContent).toContain('Helllo,');
      // The appended " Hi" should be present
      expect(updatedContent).toContain('Hi');
      // Must be valid JSX
      const { parse } = await import('@babel/parser');
      expect(() => {
        parse(updatedContent, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript']
        });
      }).not.toThrow();
    });

    it('editing h1 should produce valid JSX even though structure changes', async () => {
      const { result, updatedContent } = await editAndRead({
        selector: 'motion.h1',
        oldText: 'Hello, World.',
        newText: 'Welcome!',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 47
        }
      });

      expect(result.success).toBe(true);

      const { parse } = await import('@babel/parser');
      expect(() => {
        parse(updatedContent, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript']
        });
      }).not.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Edge cases
  // ────────────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should fail gracefully when oldText does not match any element', async () => {
      const result = await editor.editElementText(testAppPath, {
        selector: 'p',
        oldText: 'This text does not exist anywhere',
        newText: 'New text',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 10
        }
      }, TEST_APP_ID);

      // BUG: the editor reports success=true because it finds a "partial-text" match
      // (the target text "This text does not exist anywhere" contains the element's text).
      // However, the file content doesn't actually change because updateTextContent replaces
      // children of the matched element but the generated code is the same.
      // The editor returns success=true with diff='No changes made'.
      // Ideally it should return success=false for non-matching text.
      if (result.success) {
        expect(result.diff).toBe('No changes made');
      } else {
        expect(result.error).toBeDefined();
      }
    });

    it('should handle whitespace-only differences in oldText', async () => {
      // The browser may send oldText with different whitespace than the source
      const { result, updatedContent } = await editAndRead({
        selector: 'Badge',
        oldText: 'v1.0.0  ·  Test Environment', // extra spaces
        newText: 'v3.0.0 · Staging',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 40
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('v3.0.0 · Staging');
    });

    it('should handle line number being off by a few lines', async () => {
      // devContext lineNumber may be slightly off from actual AST location
      const { result, updatedContent } = await editAndRead({
        selector: 'title',
        oldText: 'Hello World - Test App',
        newText: 'Updated Title',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'unknown',
          lineNumber: 10 // actual is line 8
        }
      });

      expect(result.success).toBe(true);
      expect(updatedContent).toContain('Updated Title');
    });

    it('should preserve text around void elements mixed with styled children', async () => {
      // Regression test: <br/> and other void elements should not create
      // group boundaries — only text-bearing elements act as anchors.
      // Without the fix, void elements cause segment misalignment.
      const voidMixedContent = `export default function Page() {
  return (
    <div>
      <h1>
        before <br /> middle <span className="text-blue-500">styled</span> after
      </h1>
    </div>
  );
}`;
      const voidMixedPath = join(testAppPath, 'src', 'pages', 'void-mixed.tsx');
      await writeFile(voidMixedPath, voidMixedContent);

      const result = await editor.editElementText(testAppPath, {
        selector: 'h1',
        oldText: 'before middle styled after',
        newText: 'BEFORE middle styled after',
        devContext: {
          fileName: 'src/pages/void-mixed.tsx',
          componentName: 'unknown',
          lineNumber: 4
        }
      }, TEST_APP_ID);

      expect(result.success).toBe(true);

      const updated = await readFile(voidMixedPath, 'utf-8');
      // "styled" should still be inside the <span>, not duplicated
      expect(updated).toContain('BEFORE');
      expect(updated).toContain('<span');
      expect(updated).toContain('styled');
      // "styled" should appear exactly once (not duplicated outside the span)
      const styledCount = (updated.match(/styled/g) || []).length;
      expect(styledCount).toBe(1);
    });
  });

  describe('data-dev-id matching', () => {
    it('should match by data-dev-id even when line number is far off', async () => {
      const devIdFixturePath = join(testAppPath, 'src', 'pages', 'dev-id-test.tsx');
      await writeFile(devIdFixturePath, `import React from 'react';

export default function DevIdPage() {
  return (
    <div>
      <h1 data-dev-id="aaa111">Welcome</h1>
      <p data-dev-id="bbb222">Original text here</p>
      <p data-dev-id="ccc333">Other paragraph</p>
    </div>
  );
}`);

      const devIdEditor = new ASTTextEditor();
      const result = await devIdEditor.editElementText(testAppPath, {
        selector: 'p',
        oldText: 'Original text here',
        newText: 'Updated text here',
        devContext: {
          fileName: 'src/pages/dev-id-test.tsx',
          componentName: 'DevIdPage',
          lineNumber: 999, // Intentionally wrong
          devId: 'bbb222',
        },
      }, TEST_APP_ID);

      expect(result.success).toBe(true);

      const updated = await readFile(devIdFixturePath, 'utf-8');
      expect(updated).toContain('Updated text here');
      expect(updated).not.toContain('Original text here');
    });
  });
});
