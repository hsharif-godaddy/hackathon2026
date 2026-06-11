import type { Meta, StoryObj } from '@storybook/react-vite';
import AsyncIcon from '@ux/icon/async-icon.js';
import { type ComponentProps, useEffect, useState } from 'react';
import { userEvent, within } from 'storybook/test';

import { Milestone } from '../milestone/index';
import '../milestone/styles.css';
import { ThinkingIndicator } from '../../primitives/thinking-indicator/index';
import { Thinker } from './index';
// `./styles.css` already `@import`s `../../primitives/thinking-indicator/styles.css`,
// so consumers (and Storybook) get the indicator styles for free via Thinker's stylesheet.
import './styles.css';

const meta: Meta<typeof Thinker> = {
  title: 'Chat / Thinker',
  component: Thinker,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Chat-surface status indicator for AI work in progress. `Thinker` supports an animated status row, an optional reasoning preview above the header, and optional timeline or checklist details below it. Generic status and control labels work out of the box and can be overridden when needed.',
      },
    },
  },
  argTypes: {
    showAnimation: {
      control: 'boolean',
      description:
        'Whether to render the animated dots. Also disables label shimmer by default when false, unless `shimmer` is explicitly set.',
    },
    shimmer: {
      control: 'boolean',
      description: 'Animate a shimmer left-to-right over the label while streaming.',
    },
    label: { control: 'text' },
    ariaLabel: {
      control: 'text',
      description:
        'Preferred explicit status-region label. If omitted, the effective name falls back to a native `aria-label` attribute, then `label`, then `"Working…"`.',
    },
    showDetailsLabel: {
      control: 'text',
      description: 'Optional collapsed-toggle label. Defaults to `"Show details"`.',
    },
    hideDetailsLabel: {
      control: 'text',
      description: 'Optional expanded-toggle label. Defaults to `"Hide details"`.',
    },
    defaultOpen: { control: 'boolean', if: { arg: 'open', exists: false } },
  },
};

export default meta;

type Story = StoryObj<typeof Thinker>;

export const Default: Story = {
  args: {
    showAnimation: true,
    label: 'Generating a response',
  },
};

export const IndicatorOnly: Story = {
  args: {
    showAnimation: true,
    ariaLabel: 'Generating a response',
  },
};

export const SpinnerIndicator: Story = {
  name: 'Indicator: spinner variant',
  parameters: {
    docs: {
      description: {
        story:
          'Pass a configured `<ThinkingIndicator>` (or any other element) via the `indicator` prop to swap out the default three-dot animation. Useful in dense surfaces where the dots feel busy.',
      },
    },
  },
  args: {
    showAnimation: true,
    label: 'Editing your site',
    indicator: <ThinkingIndicator variant="spinner" />,
  },
};

export const GoDaddyIndicator: Story = {
  name: 'Indicator: GoDaddy brand mark',
  parameters: {
    docs: {
      description: {
        story:
          'Pass `<ThinkingIndicator variant="godaddy" />` for hero "the AI is working on it" moments. The bouncing brand mark is heavier than the dots or spinner, so reserve it for the most prominent "agent is generating" surfaces and avoid stacking it inside dense status rows.',
      },
    },
  },
  args: {
    showAnimation: true,
    label: 'Generating with AI',
    indicator: <ThinkingIndicator variant="godaddy" />,
  },
};

export const ThinkingDaddyIndicator: Story = {
  name: 'Indicator: Thinking Daddy',
  parameters: {
    docs: {
      description: {
        story:
          'Pass `<ThinkingIndicator variant="thinking-daddy" />` for the approved mascot animation in agent-working status rows.',
      },
    },
  },
  args: {
    showAnimation: true,
    label: 'Thinking…',
    indicator: <ThinkingIndicator variant="thinking-daddy" />,
  },
};

export const Resolved: Story = {
  args: {
    showAnimation: false,
    shimmer: false,
    label: 'Done',
  },
};

export const CompleteDeprecated: Story = {
  name: 'Complete — deprecated, use Milestone',
  parameters: {
    docs: {
      description: {
        story:
          '`complete` is deprecated. Use [`Milestone`](/?path=/docs/chat-milestone--docs) for "agent finished" UI — it owns the same panel-above-label disclosure shape and additionally exposes first-class `actions` and `feedback`. See the [Migration](#story--chat-thinker--migration-to-milestone) story for a side-by-side.',
      },
    },
  },
  args: {
    showAnimation: false,
    shimmer: false,
    label: 'Done',
    complete: true,
    reasoningBlock: (
      <Thinker.Reasoning>
        I grouped the request into a few themes, validated the likely edge cases, and turned that
        into a short plan before answering. The full reasoning stream appears here in its entirety
        when the section is revealed.
      </Thinker.Reasoning>
    ),
    children: (
      <Thinker.Checklist>
        <Thinker.ChecklistItem complete>Reviewed your inputs.</Thinker.ChecklistItem>
        <Thinker.ChecklistItem complete>Identified three directions.</Thinker.ChecklistItem>
        <Thinker.ChecklistItem complete>Drafted one option per direction.</Thinker.ChecklistItem>
      </Thinker.Checklist>
    ),
  },
};

export const CompleteOpenDeprecated: Story = {
  name: 'Complete (revealed) — deprecated, use Milestone',
  parameters: {
    docs: {
      description: {
        story:
          '`complete` is deprecated. Use [`Milestone`](/?path=/docs/chat-milestone--docs) instead. The done-state shape moved unchanged, so the migration is mechanical.',
      },
    },
  },
  args: {
    ...CompleteDeprecated.args,
    defaultOpen: true,
  },
};

export const MigrationToMilestone: Story = {
  name: 'Migration: Thinker.complete → Milestone',
  parameters: {
    docs: {
      description: {
        story:
          'Top: the deprecated `<Thinker complete>` shape. Bottom: the equivalent `<Milestone>`. Both render the same reasoning panel + checklist; `Milestone` additionally exposes `actions` and `feedback`.',
      },
    },
  },
  render: () => {
    const reasoning = (
      <Thinker.Reasoning>
        I grouped the request into a few themes, validated the likely edge cases, and turned that
        into a short plan before answering.
      </Thinker.Reasoning>
    );
    const checklist = (
      <Thinker.Checklist>
        <Thinker.ChecklistItem complete>Reviewed your inputs.</Thinker.ChecklistItem>
        <Thinker.ChecklistItem complete>Drafted one option per direction.</Thinker.ChecklistItem>
      </Thinker.Checklist>
    );
    return (
      <div style={{ display: 'flex', flexDirection: 'column', rowGap: 24 }}>
        <Thinker complete showAnimation={false} label="Done" reasoningBlock={reasoning}>
          {checklist}
        </Thinker>
        <Milestone label="Done" reasoningBlock={reasoning}>
          {checklist}
        </Milestone>
      </div>
    );
  },
};

export const PanelCollapsed: Story = {
  args: {
    showAnimation: true,
    label: 'Thinking through your request',
    children: (
      <Thinker.Timeline>
        <Thinker.Step>Inspecting the supplied inputs and planning the next steps.</Thinker.Step>
      </Thinker.Timeline>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Show details' }));
  },
};

export const PanelExpanded: Story = {
  args: {
    showAnimation: true,
    label: 'Thinking through your request',
    defaultOpen: true,
    children: (
      <Thinker.Timeline>
        <Thinker.Step icon={<AsyncIcon icon="checkmark" />} emphasis="success">
          Inspected the supplied brief.
        </Thinker.Step>
        <Thinker.Step icon={<AsyncIcon icon="circle" />} emphasis="info">
          Identified three concrete directions.
        </Thinker.Step>
        <Thinker.Step icon={<AsyncIcon icon="alert" />} emphasis="warning">
          Drafting one option for each direction.
        </Thinker.Step>
      </Thinker.Timeline>
    ),
  },
};

export const StepsWithoutIcons: Story = {
  args: {
    showAnimation: true,
    label: 'Generating a response',
    defaultOpen: true,
    children: (
      <Thinker.Timeline>
        {Array.from(
          { length: 5 },
          (_, i) => `Step ${i + 1}: Analyzing fragment ${i + 1} against the planning rubric.`,
        ).map((stepLabel) => (
          <Thinker.Step key={stepLabel}>{stepLabel}</Thinker.Step>
        ))}
      </Thinker.Timeline>
    ),
  },
};

export const StepsWithIcons: Story = {
  name: 'Steps with icons',
  args: {
    showAnimation: true,
    label: 'Retrying after a rate limit',
    defaultOpen: true,
    children: (
      <Thinker.Timeline>
        <Thinker.Step icon={<AsyncIcon icon="clock" />} emphasis="warning">
          Waiting for the external API to respond.
        </Thinker.Step>
        <Thinker.Step icon={<AsyncIcon icon="checkmark" />} emphasis="success">
          All checks passed.
        </Thinker.Step>
        <Thinker.Step icon={<AsyncIcon icon="alert" />} emphasis="critical">
          Rate limit exceeded. Retrying with backoff.
        </Thinker.Step>
        <Thinker.Step icon={<AsyncIcon icon="information" />} emphasis="info">
          Using cached results from the previous run.
        </Thinker.Step>
      </Thinker.Timeline>
    ),
  },
};

export const StreamingTimeline: Story = {
  name: 'Streaming timeline (simulated)',
  args: {
    showAnimation: true,
    label: 'Thinking through your request',
    defaultOpen: true,
  },
  render: (args) => <StreamingDemo {...args} />,
};

function StreamingDemo(args: ComponentProps<typeof Thinker>) {
  const [steps, setSteps] = useState<string[]>([]);

  useEffect(() => {
    const lines: readonly string[] = [
      'Parsing the request…',
      'Gathering prior context…',
      'Drafting three candidate answers…',
      'Scoring candidates against the rubric…',
      'Finalizing the response…',
    ];

    let i = 0;
    const id = setInterval(() => {
      const next = lines[i];
      if (next === undefined) {
        clearInterval(id);
        return;
      }

      i += 1;
      setSteps((prev) => [...prev, next]);
    }, 700);

    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ width: 480 }}>
      <Thinker {...args}>
        <Thinker.Timeline>
          {steps.map((step) => (
            <Thinker.Step key={step}>{step}</Thinker.Step>
          ))}
        </Thinker.Timeline>
      </Thinker>
    </div>
  );
}

export const WithReasoningBlock: Story = {
  name: 'With reasoning block (collapsed)',
  args: {
    showAnimation: true,
    label: 'Thinking through your request',
    reasoningBlock: (
      <Thinker.Reasoning>
        I’m looking across the supplied constraints, grouping them into a few stable themes, and
        narrowing the response to the strongest options before answering.
      </Thinker.Reasoning>
    ),
  },
};

export const StreamingReasoningBlock: Story = {
  name: 'Streaming reasoning block (simulated)',
  args: {
    showAnimation: true,
    label: 'Thinking through your request',
  },
  render: (args) => <StreamingReasoningDemo {...args} />,
};

function StreamingReasoningDemo(args: ComponentProps<typeof Thinker>) {
  const [text, setText] = useState('');

  useEffect(() => {
    const tokens = [
      'Let me think through this carefully. ',
      'The request needs a few concrete answer paths. ',
      'I should weigh clarity, completeness, and the likely next question. ',
      'The final response should stay concise but still explain the trade-offs. ',
      'I’m drafting the strongest option now.',
    ];

    let i = 0;
    const id = setInterval(() => {
      const next = tokens[i];
      if (next === undefined) {
        clearInterval(id);
        return;
      }

      i += 1;
      setText((prev) => prev + next);
    }, 400);

    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ width: 480 }}>
      <Thinker {...args} reasoningBlock={<Thinker.Reasoning>{text}</Thinker.Reasoning>} />
    </div>
  );
}

export const ReasoningBlockWithTimeline: Story = {
  name: 'Reasoning block + timeline together',
  args: {
    showAnimation: true,
    label: 'Thinking through your request',
    defaultOpen: true,
    reasoningBlock: (
      <Thinker.Reasoning>
        I’m grouping the request into a few themes, validating the likely edge cases, and turning
        that into a short plan before I answer.
      </Thinker.Reasoning>
    ),
    children: (
      <Thinker.Timeline>
        <Thinker.Step icon={<AsyncIcon icon="checkmark" />} emphasis="success">
          Parsed the request.
        </Thinker.Step>
        <Thinker.Step icon={<AsyncIcon icon="circle" />} emphasis="info">
          Researching supporting context.
        </Thinker.Step>
        <Thinker.Step icon={<AsyncIcon icon="alert" />} emphasis="warning">
          Drafting the response.
        </Thinker.Step>
      </Thinker.Timeline>
    ),
  },
};

export const ChecklistCollapsed: Story = {
  name: 'Checklist (collapsed)',
  args: {
    showAnimation: true,
    label: 'Planning your request',
    children: (
      <Thinker.Checklist>
        <Thinker.ChecklistItem complete>Reviewing your inputs.</Thinker.ChecklistItem>
        <Thinker.ChecklistItem>Drafting a plan of action.</Thinker.ChecklistItem>
        <Thinker.ChecklistItem>Finalizing the response.</Thinker.ChecklistItem>
      </Thinker.Checklist>
    ),
  },
};

export const ChecklistExpanded: Story = {
  name: 'Checklist (expanded)',
  args: {
    showAnimation: true,
    label: 'Drafting options for your review',
    defaultOpen: true,
    children: (
      <Thinker.Checklist>
        <Thinker.ChecklistItem complete>Reviewed your inputs.</Thinker.ChecklistItem>
        <Thinker.ChecklistItem complete>Identified three directions.</Thinker.ChecklistItem>
        <Thinker.ChecklistItem complete>Drafted one option per direction.</Thinker.ChecklistItem>
        <Thinker.ChecklistItem>Awaiting your feedback.</Thinker.ChecklistItem>
      </Thinker.Checklist>
    ),
  },
};

export const ChecklistStreaming: Story = {
  name: 'Checklist (streaming, simulated)',
  args: {
    showAnimation: true,
    label: 'Working through your request',
    defaultOpen: true,
  },
  render: (args) => <ChecklistStreamingDemo {...args} />,
};

function ChecklistStreamingDemo(args: ComponentProps<typeof Thinker>) {
  const items: readonly { label: string; complete: boolean }[] = [
    { label: 'Parsing the request…', complete: true },
    { label: 'Gathering prior context…', complete: true },
    { label: 'Drafting three candidate answers…', complete: false },
    { label: 'Scoring candidates against the rubric…', complete: false },
    { label: 'Finalizing the response…', complete: false },
  ];
  const total = items.length;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (count >= total) return;

    const id = setTimeout(() => setCount((n) => n + 1), 800);
    return () => clearTimeout(id);
  }, [count, total]);

  return (
    <div style={{ width: 480 }}>
      <Thinker {...args}>
        <Thinker.Checklist>
          {items.slice(0, count).map((item) => (
            <Thinker.ChecklistItem key={item.label} complete={item.complete}>
              {item.label}
            </Thinker.ChecklistItem>
          ))}
        </Thinker.Checklist>
      </Thinker>
    </div>
  );
}

export const Controlled: Story = {
  args: {
    showAnimation: true,
    label: 'Thinking through your request',
  },
  render: (args) => <ControlledDemo {...args} />,
};

function ControlledDemo(args: ComponentProps<typeof Thinker>) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 480 }}>
      <button type="button" onClick={() => setOpen((value) => !value)}>
        External toggle (open: {String(open)})
      </button>
      <Thinker {...args} open={open} onOpenChange={setOpen}>
        <Thinker.Timeline>
          <Thinker.Step>Panel state is driven by the parent.</Thinker.Step>
        </Thinker.Timeline>
      </Thinker>
    </div>
  );
}
