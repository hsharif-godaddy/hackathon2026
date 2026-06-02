import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Growl from '@ux/growl';
import '@ux/growl/styles';
import type { CSSProperties } from 'react';

import { BuilderHeader, DEFAULT_BUILDER_SECTIONS } from './BuilderHeader';
import './styles.css';

const meta: Meta<typeof BuilderHeader> = {
  title: 'Surfaces / BuilderHeader',
  component: BuilderHeader,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Top-level builder app header. Three configurable clusters (brand, sections, actions) sized for full-viewport page chrome. No background on desktop — pair with a low-contrast page canvas so the header reads as an edge band.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof BuilderHeader>;

/** Default header with all three default clusters. */
export const Default: Story = {
  render: () => (
    <Box
      displayType="flex"
      orientation="vertical"
      className="gdai-cmp-intents-ux-boxLowContrast"
      style={{ minHeight: '100vh' } as CSSProperties}
    >
      <Growl closeLabel="Dismiss all" />
      <BuilderHeader
        leading={<BuilderHeader.Brand />}
        center={
          <BuilderHeader.Sections
            sections={DEFAULT_BUILDER_SECTIONS}
            defaultActiveSectionId="edit"
          />
        }
        trailing={
          <BuilderHeader.Actions
            onPublish={() =>
              Growl.addGrowlMessage({
                id: `bh-publish-${Date.now()}`,
                title: 'Publish',
                children: 'Would open the publish flow.',
                emphasis: 'info',
                lifetime: 3500,
              })
            }
            onShare={() =>
              Growl.addGrowlMessage({
                id: `bh-share-${Date.now()}`,
                title: 'Share',
                children: 'Would open the share dialog.',
                emphasis: 'info',
                lifetime: 3500,
              })
            }
            onRefresh={() =>
              Growl.addGrowlMessage({
                id: `bh-refresh-${Date.now()}`,
                title: 'Refresh',
                children: 'Would reload the workspace.',
                emphasis: 'info',
                lifetime: 3500,
              })
            }
            onUserClick={() =>
              Growl.addGrowlMessage({
                id: `bh-user-${Date.now()}`,
                title: 'User menu',
                children: 'Would open the account menu.',
                emphasis: 'info',
                lifetime: 3500,
              })
            }
          />
        }
      />
    </Box>
  ),
};

/** Sections-only: brand and actions clusters omitted. */
export const SectionsOnly: Story = {
  render: () => (
    <Box
      displayType="flex"
      orientation="vertical"
      className="gdai-cmp-intents-ux-boxLowContrast"
      style={{ minHeight: '100vh' } as CSSProperties}
    >
      <BuilderHeader center={<BuilderHeader.Sections sections={DEFAULT_BUILDER_SECTIONS} />} />
    </Box>
  ),
};

/** Compact icon strip — inactive segments collapse to icon + tooltip. */
export const CollapseInactiveSections: Story = {
  render: () => (
    <Box
      displayType="flex"
      orientation="vertical"
      className="gdai-cmp-intents-ux-boxLowContrast"
      style={{ minHeight: '100vh' } as CSSProperties}
    >
      <BuilderHeader
        center={
          <BuilderHeader.Sections
            sections={DEFAULT_BUILDER_SECTIONS}
            defaultActiveSectionId="edit"
            collapseInactive
          />
        }
      />
    </Box>
  ),
};

/** No sections — brand and actions only, useful for surfaces with a single mode. */
export const BrandAndActions: Story = {
  render: () => (
    <Box
      displayType="flex"
      orientation="vertical"
      className="gdai-cmp-intents-ux-boxLowContrast"
      style={{ minHeight: '100vh' } as CSSProperties}
    >
      <BuilderHeader leading={<BuilderHeader.Brand />} trailing={<BuilderHeader.Actions />} />
    </Box>
  ),
};
