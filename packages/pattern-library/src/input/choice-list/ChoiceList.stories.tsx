import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import { useState } from 'react';

import { UserMessage } from '../../chat/user-message';
import '../../chat/user-message/styles.css';
import { ChoiceListItemContent } from './ChoiceListItemContent';
import { ChoiceList } from './index';
import '@ux/box/styles';
import '@ux/button/styles';
import '@ux/checkbox/styles';
import '@ux/listbox/styles';
import '@ux/tag/styles';
import '@ux/text-entry/styles';
import './styles.css';

const meta: Meta<typeof ChoiceList> = {
  title: 'Input / ChoiceList',
  component: ChoiceList,
  tags: ['autodocs'],
  argTypes: {
    optionDividers: {
      control: 'boolean',
      description:
        'Show horizontal dividers (`ux.box.borderWidth` × `ux.box.borderColor`) between option rows (single- and multi-select). Defaults to `true`. Pass `optionDividers={false}` to restore the spaced-card layout.',
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 'min(calc(100vw - 2rem), 700px)' }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Decision UI for AI-driven chat flows. Option rows render without card chrome — the consumer owns the outer surface. Single-select steps use **`@ux/listbox`** **`as="listbox"`** with **`design="option"`** rows and a trailing chevron. **`optionDividers`** optionally stacks rows into one continuous list with horizontal separators. Supports **multi-select** (checkbox), **multi-step** flows, **`allowOther`** (free text), and **`disabled`**.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ChoiceList>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIRECTION_LABELS: Record<string, string> = {
  landing: 'Build a landing page',
  campaign: 'Launch an email campaign',
  research: 'Run customer research calls',
};

const FEATURE_LABELS: Record<string, string> = {
  blog: 'Blog',
  shop: 'Online shop',
  gallery: 'Photo gallery',
  booking: 'Appointment booking',
  contact: 'Contact form',
};

const MIXED_LABELS: Record<string, Record<string, string>> = {
  industry: {
    tech: 'Technology',
    food: 'Food and Beverage',
    retail: 'Retail',
    services: 'Professional Services',
  },
  features: FEATURE_LABELS,
  style: {
    modern: 'Modern and minimal',
    classic: 'Classic and elegant',
    playful: 'Playful and colorful',
  },
};

function renderResults(
  result: Record<string, string | string[] | null>,
  stepIds: string[],
  labels: Record<string, Record<string, string>>,
) {
  return (
    <Box orientation="vertical" gap="md">
      {stepIds
        .filter((step) => result[step] != null)
        .map((step) => {
          const raw = result[step];
          if (Array.isArray(raw)) {
            return (
              <UserMessage key={step}>
                {raw.map((v) => labels[step]?.[v] ?? v).join(', ')}
              </UserMessage>
            );
          }
          if (typeof raw !== 'string') return null;
          return <UserMessage key={step}>{labels[step]?.[raw] ?? raw}</UserMessage>;
        })}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// 1. Single select
// ---------------------------------------------------------------------------

function SingleSelectExample() {
  const [selected, setSelected] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  if (selected) return <UserMessage>{DIRECTION_LABELS[selected] ?? selected}</UserMessage>;
  return (
    <ChoiceList
      title="Which direction should I explore first?"
      onDecision={(v) => setSelected(v)}
      onClose={() => setDismissed(true)}
    >
      <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
      <ChoiceList.Item value="campaign">Launch an email campaign</ChoiceList.Item>
      <ChoiceList.Item value="research">Run customer research calls</ChoiceList.Item>
    </ChoiceList>
  );
}

export const SingleSelect: Story = {
  name: 'Single select',
  render: () => <SingleSelectExample />,
};

function DeferredNoChevronExample() {
  const [selected, setSelected] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  if (selected) return <UserMessage>{DIRECTION_LABELS[selected] ?? selected}</UserMessage>;
  return (
    <ChoiceList
      ariaLabel="Which direction should I explore first?"
      commitBehavior="deferred"
      showOptionChevron={false}
      selected={selected ?? undefined}
      onSelectedChange={setSelected}
      onClose={() => setDismissed(true)}
    >
      <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
      <ChoiceList.Item value="campaign">Launch an email campaign</ChoiceList.Item>
      <ChoiceList.Item value="research">Run customer research calls</ChoiceList.Item>
    </ChoiceList>
  );
}

export const DeferredNoChevron: Story = {
  name: 'Deferred, no chevron',
  render: () => <DeferredNoChevronExample />,
};

function SingleSelectWithDividersExample() {
  const [selected, setSelected] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  if (selected) return <UserMessage>{DIRECTION_LABELS[selected] ?? selected}</UserMessage>;
  return (
    <ChoiceList
      optionDividers
      title="Which direction should I explore first?"
      onDecision={(v) => setSelected(v)}
      onClose={() => setDismissed(true)}
    >
      <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
      <ChoiceList.Item value="campaign">Launch an email campaign</ChoiceList.Item>
      <ChoiceList.Item value="research">Run customer research calls</ChoiceList.Item>
    </ChoiceList>
  );
}

function SingleSelectWithOtherExample() {
  const [selected, setSelected] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  if (selected) return <UserMessage>{DIRECTION_LABELS[selected] ?? selected}</UserMessage>;
  return (
    <ChoiceList
      title="Which direction should I explore first?"
      allowOther
      otherPlaceholder="Describe your direction"
      onDecision={(v) => setSelected(v)}
      onClose={() => setDismissed(true)}
    >
      <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
      <ChoiceList.Item value="campaign">Launch an email campaign</ChoiceList.Item>
      <ChoiceList.Item value="research">Run customer research calls</ChoiceList.Item>
    </ChoiceList>
  );
}

export const SingleSelectAllowOther: Story = {
  name: 'Single select (allow other)',
  parameters: {
    docs: {
      description: {
        story:
          '**`allowOther`** adds **`@ux/text-entry`** below the listbox; hint text is the **`otherPlaceholder`** string (default **Type your own**). **Enter** submits trimmed text through **`onDecision`** like a normal pick.',
      },
    },
    a11y: {
      config: {
        rules: [{ id: 'color-contrast', enabled: true }],
      },
    },
  },
  render: () => <SingleSelectWithOtherExample />,
};

function MultiSelectWithOtherExample() {
  const [result, setResult] = useState<Record<string, string | string[] | null> | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (result) return renderResults(result, ['features'], MIXED_LABELS);

  return (
    <ChoiceList
      allowOther
      otherPlaceholder="Describe a feature"
      onComplete={(selections) => setResult(selections)}
      onClose={() => setDismissed(true)}
    >
      <ChoiceList.Step
        id="features"
        title="What features does your site need?"
        selectionMode="multiple"
      >
        <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
        <ChoiceList.Item value="shop">Online shop</ChoiceList.Item>
        <ChoiceList.Item value="gallery">Photo gallery</ChoiceList.Item>
        <ChoiceList.Item value="booking">Appointment booking</ChoiceList.Item>
        <ChoiceList.Item value="contact">Contact form</ChoiceList.Item>
      </ChoiceList.Step>
    </ChoiceList>
  );
}

export const MultiSelectAllowOther: Story = {
  name: 'Multi select (allow other)',
  parameters: {
    docs: {
      description: {
        story:
          'Checkbox (no visible label; SR **`aria-label`**) + **`TextEntry`** with the same placeholder pattern. **Continue** appends trimmed text when the custom checkbox is checked and non-empty.',
      },
    },
    a11y: {
      config: {
        rules: [{ id: 'color-contrast', enabled: true }],
      },
    },
  },
  render: () => <MultiSelectWithOtherExample />,
};

function DisabledExample() {
  return (
    <ChoiceList
      disabled
      title="This list is temporarily unavailable"
      ariaLabel="Example disabled choice list"
      onDecision={() => {}}
      onClose={() => {}}
    >
      <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
      <ChoiceList.Item value="campaign">Launch an email campaign</ChoiceList.Item>
    </ChoiceList>
  );
}

export const Disabled: Story = {
  name: 'Disabled',
  parameters: {
    docs: {
      description: {
        story:
          '**`disabled`** applies **`inert`**, **`aria-disabled`**, reduced opacity, and blocks callbacks.',
      },
    },
    a11y: {
      config: {
        rules: [{ id: 'color-contrast', enabled: true }],
      },
    },
  },
  render: () => <DisabledExample />,
};

export const SingleSelectOptionDividers: Story = {
  name: 'Single select (option dividers)',
  parameters: {
    docs: {
      description: {
        story:
          '**`optionDividers`** stacks rows and draws separators using **`ux.box.borderWidth`** and **`ux.box.borderColor`** between options. Same on multi-select checkbox steps.',
      },
    },
    a11y: {
      config: {
        rules: [{ id: 'color-contrast', enabled: true }],
      },
    },
  },
  render: () => <SingleSelectWithDividersExample />,
};

// ---------------------------------------------------------------------------
// 2. Multi select
// ---------------------------------------------------------------------------

function MultiSelectExample() {
  const [result, setResult] = useState<Record<string, string | string[] | null> | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (result) return renderResults(result, ['features'], MIXED_LABELS);

  return (
    <ChoiceList
      onComplete={(selections) => setResult(selections)}
      onClose={() => setDismissed(true)}
    >
      <ChoiceList.Step
        id="features"
        title="What features does your site need?"
        selectionMode="multiple"
      >
        <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
        <ChoiceList.Item value="shop">Online shop</ChoiceList.Item>
        <ChoiceList.Item value="gallery">Photo gallery</ChoiceList.Item>
        <ChoiceList.Item value="booking">Appointment booking</ChoiceList.Item>
        <ChoiceList.Item value="contact">Contact form</ChoiceList.Item>
      </ChoiceList.Step>
    </ChoiceList>
  );
}

export const MultiSelect: Story = {
  name: 'Multi select',
  render: () => <MultiSelectExample />,
};

// ---------------------------------------------------------------------------
// 3. Multi step (mixed)
// ---------------------------------------------------------------------------

function MixedMultiStepExample() {
  const [result, setResult] = useState<Record<string, string | string[] | null> | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (result) return renderResults(result, ['industry', 'features', 'style'], MIXED_LABELS);

  return (
    <ChoiceList
      onComplete={(selections) => setResult(selections)}
      onClose={() => setDismissed(true)}
    >
      <ChoiceList.Step id="industry" title="What industry are you in?">
        <ChoiceList.Item value="tech">Technology</ChoiceList.Item>
        <ChoiceList.Item value="food">Food and Beverage</ChoiceList.Item>
        <ChoiceList.Item value="retail">Retail</ChoiceList.Item>
        <ChoiceList.Item value="services">Professional Services</ChoiceList.Item>
      </ChoiceList.Step>
      <ChoiceList.Step
        id="features"
        title="What features does your site need?"
        selectionMode="multiple"
      >
        <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
        <ChoiceList.Item value="shop">Online shop</ChoiceList.Item>
        <ChoiceList.Item value="gallery">Photo gallery</ChoiceList.Item>
        <ChoiceList.Item value="booking">Appointment booking</ChoiceList.Item>
        <ChoiceList.Item value="contact">Contact form</ChoiceList.Item>
      </ChoiceList.Step>
      <ChoiceList.Step id="style" title="What style resonates with your brand?">
        <ChoiceList.Item value="modern">Modern and minimal</ChoiceList.Item>
        <ChoiceList.Item value="classic">Classic and elegant</ChoiceList.Item>
        <ChoiceList.Item value="playful">Playful and colorful</ChoiceList.Item>
      </ChoiceList.Step>
    </ChoiceList>
  );
}

export const MixedMultiStep: Story = {
  name: 'Multi step (mixed)',
  render: () => <MixedMultiStepExample />,
};

// ---------------------------------------------------------------------------
// 4. Long labels (wrapping)
// ---------------------------------------------------------------------------

const LONG_LABELS: Record<string, string> = {
  guided: 'Walk me through a guided, step-by-step setup so I can understand each decision as we go',
  template:
    'Start from a pre-built template and let me customize only the parts that matter most to my business',
  scratch: 'Build everything from scratch with full control over structure, content, and design',
  import:
    'Import my existing content and have AI reorganize it into a polished, publication-ready format',
};

function LongLabelsExample() {
  const [selected, setSelected] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  if (selected) return <UserMessage>{LONG_LABELS[selected] ?? selected}</UserMessage>;
  return (
    <ChoiceList
      title="Which approach best fits your situation?"
      onDecision={(v) => setSelected(v)}
      onClose={() => setDismissed(true)}
    >
      {Object.entries(LONG_LABELS).map(([value, label]) => (
        <ChoiceList.Item key={value} value={value}>
          {label}
        </ChoiceList.Item>
      ))}
    </ChoiceList>
  );
}

export const LongLabels: Story = {
  name: 'Long labels (wrapping)',
  decorators: [
    (Story) => (
      <div style={{ width: 'min(calc(100vw - 2rem), 375px)' }}>
        <Story />
      </div>
    ),
  ],
  render: () => <LongLabelsExample />,
};

// ---------------------------------------------------------------------------
// 5. Long labels — multi-step (wrapping)
// ---------------------------------------------------------------------------

const LONG_STEP_LABELS: { approach: Record<string, string>; scope: Record<string, string> } = {
  approach: LONG_LABELS,
  scope: {
    single:
      'One focused landing page that drives visitors toward a single, specific call-to-action',
    multi:
      'A multi-page site with separate sections for services, team, blog, and contact information',
    ecommerce:
      'A full e-commerce storefront with product listings, a shopping cart, and a checkout flow',
  },
};

function LongLabelsMultiStepExample() {
  const [result, setResult] = useState<Record<string, string | string[] | null> | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (result) return renderResults(result, ['approach', 'scope'], LONG_STEP_LABELS);

  return (
    <ChoiceList
      onComplete={(selections) => setResult(selections)}
      onClose={() => setDismissed(true)}
    >
      <ChoiceList.Step id="approach" title="Which approach best fits your situation?">
        {Object.entries(LONG_STEP_LABELS.approach).map(([value, label]) => (
          <ChoiceList.Item key={value} value={value}>
            {label}
          </ChoiceList.Item>
        ))}
      </ChoiceList.Step>
      <ChoiceList.Step id="scope" title="What scope of site are you looking to build?">
        {Object.entries(LONG_STEP_LABELS.scope).map(([value, label]) => (
          <ChoiceList.Item key={value} value={value}>
            {label}
          </ChoiceList.Item>
        ))}
      </ChoiceList.Step>
    </ChoiceList>
  );
}

export const LongLabelsMultiStep: Story = {
  name: 'Long labels — multi-step (wrapping)',
  decorators: [
    (Story) => (
      <div style={{ width: 'min(calc(100vw - 2rem), 375px)' }}>
        <Story />
      </div>
    ),
  ],
  render: () => <LongLabelsMultiStepExample />,
};

// ---------------------------------------------------------------------------
// With images (supplementary)
// ---------------------------------------------------------------------------

const TEMPLATE_LABELS: Record<string, string> = {
  landing: 'Build a landing page',
  campaign: 'Launch an email campaign',
};

function WithImagesExample() {
  const [selected, setSelected] = useState<string | null>(null);
  if (selected) return <UserMessage>{TEMPLATE_LABELS[selected] ?? selected}</UserMessage>;
  return (
    <ChoiceList ariaLabel="Choose a template" onDecision={(v) => setSelected(v)}>
      <ChoiceList.Item value="landing">
        <ChoiceListItemContent
          image={<span aria-hidden="true">LP</span>}
          description="Build a landing page"
        />
      </ChoiceList.Item>
      <ChoiceList.Item value="campaign">
        <ChoiceListItemContent
          image={<span aria-hidden="true">EC</span>}
          description="Launch an email campaign"
        />
      </ChoiceList.Item>
    </ChoiceList>
  );
}

export const WithImages: Story = {
  name: 'With images',
  render: () => <WithImagesExample />,
};

// ---------------------------------------------------------------------------
// Number-key shortcuts (self)
// ---------------------------------------------------------------------------

function NumberKeyShortcutsExample() {
  const [selected, setSelected] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  if (selected) return <UserMessage>{DIRECTION_LABELS[selected] ?? selected}</UserMessage>;
  return (
    <Box orientation="vertical" gap="md">
      <ChoiceList
        title="Which direction should I explore first?"
        onDecision={(v) => setSelected(v)}
        onClose={() => setDismissed(true)}
      >
        <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
        <ChoiceList.Item value="campaign">Launch an email campaign</ChoiceList.Item>
        <ChoiceList.Item value="research">Run customer research calls</ChoiceList.Item>
      </ChoiceList>
    </Box>
  );
}

export const WithNumberKeyShortcuts: Story = {
  name: 'Number-key shortcuts',
  parameters: {
    docs: {
      description: {
        story:
          'Number-key shortcuts are **on by default** — no prop required. Tab into the list, then press **`1`**–**`9`** to focus the Nth option. **Enter** or **Space** still commits — the shortcut never auto-submits. Pass **`numberKeyShortcuts={false}`** to opt out. Modifier keys (Ctrl/Cmd/Alt) and the **Other** input are always excluded.',
      },
    },
  },
  render: () => <NumberKeyShortcutsExample />,
};
