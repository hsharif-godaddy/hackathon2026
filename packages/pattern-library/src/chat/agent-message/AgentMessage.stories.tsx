import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';

import { AgentMessage } from './index';
import './styles.css';
// Stories side-effect-import Prism's UXCore2-themed stylesheet so fenced
// code blocks render with syntax colors. Consumers of the library must do
// the same in their own app entry point.
import '@ux/code/styles';

const meta: Meta<typeof AgentMessage> = {
  title: 'Chat / AgentMessage',
  component: AgentMessage,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Chat-surface render for agent-authored markdown. `AgentMessage` renders a string of markdown through a hardened `remark` / `rehype` pipeline mapped onto UXCore2 typography. The root is a polite live region so streaming tokens are announced incrementally.',
      },
    },
  },
  argTypes: {
    children: {
      control: 'text',
      description: 'Markdown source emitted by the agent.',
    },
    ariaLabel: {
      control: 'text',
      description: 'Accessible name for the live region. Defaults to `"Assistant response"`.',
    },
  },
};

export default meta;

type Story = StoryObj<typeof AgentMessage>;

const SHORT_REPLY = `Here are **three options** for your landing page:

- A hero with a product shot
- A split-column layout with a CTA
- A full-bleed video background`;

const RICH_REPLY = `## Designing your landing page

A great landing page answers one question: *"What does this product do?"*

### What usually works

1. Lead with a concrete, benefit-driven headline.
2. Show the product in context — a screenshot beats a stock illustration.
3. Anchor the primary call to action \`above the fold\`.

### Trade-offs

> Video backgrounds look great, but they add **~2 MB** of network weight
> and struggle on older mobile hardware.

Check the [WCAG guidance on moving content](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html)
before you ship one.

---

\`\`\`tsx
<AgentMessage>{reply}</AgentMessage>
\`\`\`
`;

const CODE_REPLY = `Here's how to set up a streaming handler:

\`\`\`typescript
import { AgentMessage } from '@airo/components/chat/agent-message';

export async function streamReply(prompt: string) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
  return response.body;
}
\`\`\`

And the matching CSS:

\`\`\`css
.chat-thread {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
\`\`\`

An unfenced block still renders as a Prism-themed surface (no grammar):

\`\`\`
plain text inside a fence
\`\`\`
`;

const XSS_REPLY = `Trying to smuggle a <script>alert('xss')</script> in here.

[Click me](javascript:alert('nope'))

![Not an image](data:image/svg+xml,<svg onload="alert(1)" />)

<img src="x" onerror="alert('nope')" />`;

export const Default: Story = {
  args: {
    children: SHORT_REPLY,
  },
};

export const RichMarkdown: Story = {
  args: {
    children: RICH_REPLY,
  },
};

export const SyntaxHighlighting: Story = {
  name: 'Syntax highlighting',
  args: {
    children: CODE_REPLY,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Fenced code blocks are routed through `@ux/code`, which layers Prism.JS on top of the theme's `uxCode.*` intents. The default Prism bundle covers the clike family (JS/TS/JSX/TSX), CSS, and markup; import extra `prismjs/components/prism-*` modules in your app entry to add more languages.",
      },
    },
  },
};

// Arabic markdown covering every block this component styles so the
// logical-property rhythm (`padding-inline-start`, `border-inline-start-*`,
// `margin-block-*`) is visible with the inline axis flipped. Bidi-mixed
// content is intentional: inline `code` and the fenced `typescript` block
// stay LTR inside the RTL flow — the browser's Unicode bidi algorithm
// handles that for us as long as the component doesn't hard-code a
// direction (it doesn't).
const RTL_REPLY = `## تصميم صفحة الهبوط

الصفحة الجيدة تجيب على سؤال واحد: *"ما الذي يقدّمه هذا المنتج؟"*

### ما يعمل عادةً

1. ابدأ بعنوان واضح يركّز على الفائدة.
2. اعرض المنتج في سياقه الحقيقي — لقطة الشاشة أفضل من الصورة العامة.
3. ضع زر الإجراء الرئيسي \`above the fold\`.

### نقاط للمراجعة

- ✅ العناوين تركّز على *النتائج* لا الميزات
- 🎯 زر الإجراء الأساسي ظاهر على شاشة 1366×768
- 🔍 كل صورة لها نص بديل — بما في ذلك الصور المولّدة بالذكاء الاصطناعي
- 🌙 لقطات الوضع الداكن تطابق المظهر المباشر

### ملاحظة

> الفيديوهات في الخلفية تبدو رائعة، لكنها تضيف حوالي **2 ميغابايت** من وزن الشبكة.

يمكن استخدام نفس المكوّن داخل محادثة عربية:

\`\`\`tsx
<AgentMessage>{reply}</AgentMessage>
\`\`\`

---

راجع [إرشادات WCAG للمحتوى المتحرك](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html) قبل النشر.
`;

export const Rtl: Story = {
  name: 'RTL (logical property mirror)',
  render: (args) => (
    // `dir="rtl"` + `lang="ar"` on the wrapper so assistive tech picks the
    // right pronunciation and so `padding-inline-start` / `border-inline-
    // start-*` / `margin-inline-*` flip to the right side of the box.
    <div dir="rtl" lang="ar" style={{ maxInlineSize: 640 }}>
      <AgentMessage {...args} />
    </div>
  ),
  args: {
    children: RTL_REPLY,
    ariaLabel: 'رد المساعد',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Arabic markdown exercised under `dir="rtl"`. List bullets, blockquote accents, and title rhythm all flow from the inline-start (right) edge — the component styles exclusively use logical CSS properties, so no RTL-specific override is needed. LTR runs (inline `code`, URLs, the fenced TypeScript block) stay LTR via the browser\'s Unicode bidi algorithm.',
      },
    },
  },
};

export const HostileInput: Story = {
  name: 'Hostile input (sanitized)',
  args: {
    children: XSS_REPLY,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Agent output is never trusted. The component strips scripts, event handlers, and unsafe URL schemes before rendering. This story is a visual acceptance test — nothing in it should execute.',
      },
    },
  },
};

const STREAMING_REPLY = `## 🚀 Launch checklist for your landing page

You've narrowed the concept down — now let's make sure the build holds up before you ship. Here's what I'd double-check in the final 24 hours.

### Content polish

- ✅ Headlines lead with *outcomes*, not features
- 🎯 The primary CTA sits above the fold on a 1366×768 viewport
- 🔍 Every image has alt text — AI-generated art included
- 🌙 Dark-mode screenshots match the live theme
- 📱 Thumb-zone CTAs clear 44×44 CSS pixels
- 🌐 Copy renders in at least three locales without clipping

### 💬 Social proof

If you have customer quotes, put one above the fold. Pair each quote with a concrete metric — "cut onboarding from **8 hours to 40 minutes**" beats "love this product" every time.

> Keep quotes short enough that a screen reader can finish them before the hero video autoplays.

### 🛠 Before you hit deploy

Here's the edge-redirect we talked about so old marketing URLs don't 404 on launch day:

\`\`\`typescript
export async function onRequest({ request, next }: {
  request: Request;
  next: () => Promise<Response>;
}) {
  const url = new URL(request.url);
  if (url.pathname === '/') {
    return Response.redirect(new URL('/home', url), 302);
  }
  return next();
}
\`\`\`

---

Ping me with a preview link once it's live and I'll walk through it tile by tile. ✨
`;

/**
 * `StreamingDemo` approximates an LLM token stream by appending small,
 * jittered chunks of the source to a local buffer. It pairs with
 * `AgentMessage`'s polite live region so assistive tech announces the new
 * text incrementally — the same behavior a real streaming API exhibits.
 *
 * The replay button bumps a key so the effect tears down and re-runs from
 * the start, which is useful for inspecting the announcement cadence
 * without reloading the story.
 */
function StreamingDemo({ source, ariaLabel }: { source: string; ariaLabel?: string }) {
  const [streamed, setStreamed] = useState('');
  const [replayToken, setReplayToken] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `replayToken` is a load-bearing effect dependency: bumping it on the
  // replay button tears down the current stream and re-runs this effect from
  // the start. Biome's dependency tracker sees `replayToken` is read but not
  // "used" and suggests dropping it, which would break the replay.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    setStreamed('');
    let index = 0;
    let cancelled = false;

    function tick() {
      if (cancelled) return;
      // 2–7 chars per tick approximates the sub-word chunks an LLM typically
      // emits once a response has stabilised past the initial latency spike.
      const chunkSize = 2 + Math.floor(Math.random() * 6);
      index = Math.min(index + chunkSize, source.length);
      setStreamed(source.slice(0, index));
      if (index < source.length) {
        // 25–90ms jitter reads as a natural "typing" cadence without being
        // so slow that the demo drags.
        timerRef.current = setTimeout(tick, 25 + Math.random() * 65);
      }
    }

    // Brief lead-in so viewers see the empty bubble before content arrives,
    // which mimics the first-token latency of a real streaming call.
    timerRef.current = setTimeout(tick, 250);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [source, replayToken]);

  return (
    <div
      style={{
        maxInlineSize: 640,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <button
        type="button"
        onClick={() => setReplayToken((token) => token + 1)}
        style={{
          alignSelf: 'flex-start',
          padding: '6px 12px',
          font: 'inherit',
          fontSize: 13,
          cursor: 'pointer',
          background: 'transparent',
          border: '1px solid currentColor',
          borderRadius: 6,
        }}
      >
        Replay stream
      </button>
      <AgentMessage ariaLabel={ariaLabel}>{streamed}</AgentMessage>
    </div>
  );
}

export const StreamingSimulation: Story = {
  name: 'Streaming simulation',
  render: () => <StreamingDemo source={STREAMING_REPLY} ariaLabel="Drafting launch checklist" />,
  parameters: {
    docs: {
      description: {
        story:
          'Approximates an LLM token stream. The polite live region announces newly-appended text incrementally rather than re-reading the whole message, and the markdown pipeline handles the partially-formed syntax that arrives mid-stream. Press **Replay stream** to re-run from the start.',
      },
    },
  },
};
