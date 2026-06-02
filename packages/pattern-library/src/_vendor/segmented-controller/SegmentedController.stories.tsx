import { Icon } from '@godaddy/antares';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SegmentedController, SegmentedControllerItem } from './SegmentedController';
import './styles.css';

const meta: Meta<typeof SegmentedController> = {
  // `Vendor` (no leading underscore) sorts after `Surfaces` so the temporary
  // vendor stories land at the end of the Storybook table of contents.
  title: 'Vendor / SegmentedController',
  component: SegmentedController,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "Temporary vendor of `SegmentedController` from [godaddy/antares#187](https://github.com/godaddy/antares/pull/187). Delete this folder and switch consumers to `import { SegmentedController } from '@godaddy/antares'` once that PR ships.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SegmentedController>;

export const Basic: Story = {
  render: () => (
    <SegmentedController aria-label="View" defaultValue="day">
      <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
      <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
      <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
      <SegmentedControllerItem value="year">Year</SegmentedControllerItem>
    </SegmentedController>
  ),
};

export const Controlled: Story = {
  render: () => {
    function ControlledExample() {
      const [value, setValue] = useState('week');
      return (
        <SegmentedController aria-label="View" value={value} onSelectionChange={setValue}>
          <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
          <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
          <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
        </SegmentedController>
      );
    }
    return <ControlledExample />;
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <SegmentedController
          key={size}
          aria-label={`View (${size})`}
          size={size}
          defaultValue="day"
        >
          <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
          <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
          <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
        </SegmentedController>
      ))}
    </div>
  ),
};

export const IconAndText: Story = {
  render: () => (
    <SegmentedController aria-label="View" defaultValue="day">
      <SegmentedControllerItem value="day" icon={<Icon icon="circle" width={24} height={24} />}>
        Day
      </SegmentedControllerItem>
      <SegmentedControllerItem
        value="week"
        icon={<Icon icon="bulleted-list" width={24} height={24} />}
      >
        Week
      </SegmentedControllerItem>
      <SegmentedControllerItem value="month" icon={<Icon icon="columns" width={24} height={24} />}>
        Month
      </SegmentedControllerItem>
    </SegmentedController>
  ),
};

export const IconOnly: Story = {
  render: () => (
    <SegmentedController aria-label="View" defaultValue="day">
      <SegmentedControllerItem value="day" aria-label="Day">
        <Icon icon="circle" width={24} height={24} />
      </SegmentedControllerItem>
      <SegmentedControllerItem value="week" aria-label="Week">
        <Icon icon="bulleted-list" width={24} height={24} />
      </SegmentedControllerItem>
      <SegmentedControllerItem value="month" aria-label="Month">
        <Icon icon="columns" width={24} height={24} />
      </SegmentedControllerItem>
    </SegmentedController>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SegmentedController aria-label="Disabled group" defaultValue="day" isDisabled>
        <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
        <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
        <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
      </SegmentedController>
      <SegmentedController aria-label="Single segment disabled" defaultValue="day">
        <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
        <SegmentedControllerItem value="week" isDisabled>
          Week
        </SegmentedControllerItem>
        <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
      </SegmentedController>
    </div>
  ),
};

export const RTL: Story = {
  render: () => (
    <div dir="rtl">
      <SegmentedController aria-label="View" defaultValue="day">
        <SegmentedControllerItem value="day" icon={<Icon icon="circle" width={24} height={24} />}>
          Day
        </SegmentedControllerItem>
        <SegmentedControllerItem
          value="week"
          icon={<Icon icon="bulleted-list" width={24} height={24} />}
        >
          Week
        </SegmentedControllerItem>
        <SegmentedControllerItem
          value="month"
          icon={<Icon icon="columns" width={24} height={24} />}
        >
          Month
        </SegmentedControllerItem>
      </SegmentedController>
    </div>
  ),
};

export const CollapseInactive: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Compact, icon-first variant. Only the selected segment shows its label; the rest collapse to icon-only and surface their label via tooltip on hover or keyboard focus. The container reserves a `min-width` sized to the worst-case state so its outer footprint stays stable as selection changes.',
      },
    },
  },
  render: () => (
    <SegmentedController aria-label="Channel" defaultValue="messages" collapseInactive>
      <SegmentedControllerItem value="inbox" icon={<Icon icon="inbox" width={24} height={24} />}>
        Inbox
      </SegmentedControllerItem>
      <SegmentedControllerItem value="messages" icon={<Icon icon="email" width={24} height={24} />}>
        Messages
      </SegmentedControllerItem>
      <SegmentedControllerItem
        value="notifications"
        icon={<Icon icon="bell" width={24} height={24} />}
      >
        Notifications
      </SegmentedControllerItem>
    </SegmentedController>
  ),
};
