import { Icon } from '@godaddy/antares';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

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
type ControllerSize = 'sm' | 'md' | 'lg';

const CONTROLLER_SIZES: ControllerSize[] = ['sm', 'md', 'lg'];

function SizeExamples(props: { children: (size: ControllerSize) => ReactNode }) {
  return (
    <div
      style={{
        alignItems: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      {CONTROLLER_SIZES.map(function renderSize(size) {
        return props.children(size);
      })}
    </div>
  );
}

export const TextOnly: Story = {
  name: 'Text only',
  render: function render() {
    return (
      <SizeExamples>
        {function example(size) {
          return (
            <SegmentedController
              key={size}
              aria-label={`Text-only view (${size})`}
              size={size}
              defaultValue="day"
            >
              <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
              <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
              <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
            </SegmentedController>
          );
        }}
      </SizeExamples>
    );
  },
};

export const IconOnly: Story = {
  name: 'Icon only',
  render: function render() {
    return (
      <SizeExamples>
        {function example(size) {
          return (
            <SegmentedController
              key={size}
              aria-label={`Icon-only view (${size})`}
              size={size}
              defaultValue="day"
            >
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
          );
        }}
      </SizeExamples>
    );
  },
};

export const IconWithText: Story = {
  name: 'Icon with text',
  render: function render() {
    return (
      <SizeExamples>
        {function example(size) {
          return (
            <SegmentedController
              key={size}
              aria-label={`Icon with text view (${size})`}
              size={size}
              defaultValue="day"
            >
              <SegmentedControllerItem
                value="day"
                icon={<Icon icon="circle" width={24} height={24} />}
              >
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
          );
        }}
      </SizeExamples>
    );
  },
};

export const CollapseInactive: Story = {
  name: 'Collapse inactive',
  parameters: {
    docs: {
      description: {
        story:
          'Compact, icon-first variant. Only the selected segment shows its label; the rest collapse to icon-only and surface their label via tooltip on hover or keyboard focus. The container reserves a `min-width` sized to the worst-case state so its outer footprint stays stable as selection changes.',
      },
    },
  },
  render: function render() {
    return (
      <SizeExamples>
        {function example(size) {
          return (
            <SegmentedController
              key={size}
              aria-label={`Channel (${size})`}
              size={size}
              defaultValue="messages"
              collapseInactive
            >
              <SegmentedControllerItem
                value="inbox"
                icon={<Icon icon="inbox" width={24} height={24} />}
              >
                Inbox
              </SegmentedControllerItem>
              <SegmentedControllerItem
                value="messages"
                icon={<Icon icon="email" width={24} height={24} />}
              >
                Messages
              </SegmentedControllerItem>
              <SegmentedControllerItem
                value="notifications"
                icon={<Icon icon="bell" width={24} height={24} />}
              >
                Notifications
              </SegmentedControllerItem>
            </SegmentedController>
          );
        }}
      </SizeExamples>
    );
  },
};

export const Disabled: Story = {
  render: function render() {
    return (
      <SizeExamples>
        {function example(size) {
          return (
            <div
              key={size}
              style={{
                alignItems: 'flex-start',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <SegmentedController
                aria-label={`Disabled group (${size})`}
                size={size}
                defaultValue="day"
                isDisabled
              >
                <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
                <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
                <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
              </SegmentedController>
              <SegmentedController
                aria-label={`Single segment disabled (${size})`}
                size={size}
                defaultValue="day"
              >
                <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
                <SegmentedControllerItem value="week" isDisabled>
                  Week
                </SegmentedControllerItem>
                <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
              </SegmentedController>
            </div>
          );
        }}
      </SizeExamples>
    );
  },
};

export const RTL: Story = {
  render: function render() {
    return (
      <div dir="rtl">
        <SizeExamples>
          {function example(size) {
            return (
              <div
                key={size}
                style={{
                  alignItems: 'flex-start',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <SegmentedController
                  aria-label={`طريقة العرض (${size})`}
                  dir="rtl"
                  size={size}
                  defaultValue="day"
                >
                  <SegmentedControllerItem
                    value="day"
                    icon={<Icon icon="circle" width={24} height={24} />}
                  >
                    اليوم
                  </SegmentedControllerItem>
                  <SegmentedControllerItem
                    value="week"
                    icon={<Icon icon="bulleted-list" width={24} height={24} />}
                  >
                    الأسبوع
                  </SegmentedControllerItem>
                  <SegmentedControllerItem
                    value="month"
                    icon={<Icon icon="columns" width={24} height={24} />}
                  >
                    الشهر
                  </SegmentedControllerItem>
                </SegmentedController>
                <SegmentedController
                  aria-label={`القناة (${size})`}
                  dir="rtl"
                  size={size}
                  defaultValue="messages"
                  collapseInactive
                >
                  <SegmentedControllerItem
                    value="inbox"
                    icon={<Icon icon="inbox" width={24} height={24} />}
                  >
                    الوارد
                  </SegmentedControllerItem>
                  <SegmentedControllerItem
                    value="messages"
                    icon={<Icon icon="email" width={24} height={24} />}
                  >
                    الرسائل
                  </SegmentedControllerItem>
                  <SegmentedControllerItem
                    value="notifications"
                    icon={<Icon icon="bell" width={24} height={24} />}
                  >
                    التنبيهات
                  </SegmentedControllerItem>
                </SegmentedController>
              </div>
            );
          }}
        </SizeExamples>
      </div>
    );
  },
};
