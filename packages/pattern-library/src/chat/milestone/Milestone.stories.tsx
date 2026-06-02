import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Thinker } from '../thinker/index';
import '../thinker/styles.css';
import { Milestone, type MilestoneFeedbackValue } from './index';
import './styles.css';

const meta: Meta<typeof Milestone> = {
  title: 'Chat / Milestone',
  component: Milestone,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Chat-surface "agent finished some work" indicator. Renders a label, an optional reasoning disclosure, an optional row of declarative actions (with an ellipsis-menu overflow), and an optional thumbs-up / thumbs-down feedback affordance with a reason picker.',
      },
    },
  },
  argTypes: {
    label: { control: 'text' },
    defaultOpen: { control: 'boolean', if: { arg: 'open', exists: false } },
    menuLabel: { control: 'text' },
  },
};

export default meta;

type Story = StoryObj<typeof Milestone>;

const noop = () => undefined;

export const Default: Story = {
  args: {
    label: 'Saved your changes',
  },
};

export const WithReasoning: Story = {
  name: 'With reasoning disclosure',
  args: {
    label: 'Generated 3 ideas',
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

export const WithActions: Story = {
  name: 'With actions',
  args: {
    label: 'Saved your changes',
    actions: [
      { id: 'see', label: 'See', onSelect: noop },
      { id: 'undo', label: 'Undo', onSelect: noop, priority: 'always' },
      { id: 'archive', label: 'Archive', onSelect: noop },
      { id: 'delete', label: 'Delete', onSelect: noop, priority: 'overflow' },
    ],
  },
};

export const OverflowMenu: Story = {
  name: 'Overflow menu (narrow container)',
  parameters: {
    docs: {
      description: {
        story:
          'When the row is too narrow to fit every `auto` action inline, the rightmost ones collapse into the ellipsis menu first. The ellipsis trigger only renders when at least one action lives inside it.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 280, maxInlineSize: '100%' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    label: 'Saved your changes',
    actions: [
      { id: 'see', label: 'See', onSelect: noop },
      { id: 'edit', label: 'Edit', onSelect: noop },
      { id: 'archive', label: 'Archive', onSelect: noop },
      { id: 'duplicate', label: 'Duplicate', onSelect: noop },
      { id: 'export', label: 'Export', onSelect: noop },
    ],
  },
};

export const WithFeedback: Story = {
  name: 'With feedback (uncontrolled)',
  args: {
    label: 'Generated 3 ideas',
    feedback: {
      downReasons: [
        { id: 'wrong', label: 'Incorrect' },
        { id: 'unsafe', label: 'Unsafe' },
        { id: 'too-long', label: 'Too long' },
      ],
      onChange: (value, reason) => {
        console.log('feedback', { value, reason });
      },
    },
  },
};

export const Controlled: Story = {
  name: 'Controlled (open + feedback)',
  render: (args) => <ControlledExample {...args} />,
  args: {
    label: 'Generated 3 ideas',
    reasoningBlock: <Thinker.Reasoning>I considered the prompt’s edges.</Thinker.Reasoning>,
    actions: [
      { id: 'see', label: 'See', onSelect: noop },
      { id: 'archive', label: 'Archive', onSelect: noop },
    ],
  },
};

function ControlledExample(args: React.ComponentProps<typeof Milestone>) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<MilestoneFeedbackValue>(null);
  return (
    <Milestone
      {...args}
      open={open}
      onOpenChange={setOpen}
      feedback={{
        value,
        onChange: (next) => setValue(next),
      }}
    />
  );
}

export const Migration: Story = {
  name: 'Migration from Thinker.complete',
  parameters: {
    docs: {
      description: {
        story:
          'Side-by-side: the deprecated `Thinker complete` shape (top) and the equivalent `Milestone` (bottom). They render the same headline + reasoning panel + checklist; `Milestone` adds first-class actions and feedback that Thinker.complete cannot express.',
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
