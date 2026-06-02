import type { Meta, StoryObj } from '@storybook/react-vite';

import { UserMessage } from './index';
import './styles.css';

const meta: Meta<typeof UserMessage> = {
  title: 'Chat / UserMessage',
  component: UserMessage,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Right-aligned chat bubble for the end-user's turn. Follows `@ux/card` surface conventions but squares the block-end / inline-end corner so the bubble visually points at the user's avatar. Supports a compound `Gallery`/`Image`/`File` API with a built-in lightbox modal.",
      },
    },
  },
  argTypes: {
    children: {
      control: 'text',
      description: 'Message body. Strings render as a single `@ux/text` paragraph.',
    },
    ariaLabel: {
      control: 'text',
      description:
        'Accessible name for the `<article>` landmark the message renders. Defaults to "You said".',
    },
  },
};

export default meta;

type Story = StoryObj<typeof UserMessage>;

const SAMPLE_IMAGE = 'https://placehold.co/600x400/10b981/white?text=Hero';
// Alts double as the lightbox caption (the filename shown beneath the
// preview image) — using filename-style alts mirrors the common case of
// a user uploading files straight from their device.
const SAMPLE_IMAGE_ALT = 'landing-hero.jpg';
const SECOND_IMAGE = 'https://placehold.co/600x400/ee6688/white?text=Footer';
const SECOND_IMAGE_ALT = 'footer-banner.jpg';
const THIRD_IMAGE = 'https://placehold.co/600x400/66bbee/white?text=Cta';
const THIRD_IMAGE_ALT = 'cta-card.jpg';

export const Default: Story = {
  args: {
    children: 'Can you help me design a landing page?',
  },
};

export const SingleImage: Story = {
  name: 'Single image attachment',
  render: (args) => (
    <UserMessage {...args}>
      <UserMessage.Gallery>
        <UserMessage.Image src={SAMPLE_IMAGE} alt={SAMPLE_IMAGE_ALT} />
      </UserMessage.Gallery>
      Can you use this hero as the reference for the design?
    </UserMessage>
  ),
  args: {},
};

export const ImageGallery: Story = {
  name: 'Multiple images',
  render: (args) => (
    <UserMessage {...args}>
      <UserMessage.Gallery>
        <UserMessage.Image src={SAMPLE_IMAGE} alt={SAMPLE_IMAGE_ALT} />
        <UserMessage.Image src={SECOND_IMAGE} alt={SECOND_IMAGE_ALT} />
        <UserMessage.Image src={THIRD_IMAGE} alt={THIRD_IMAGE_ALT} />
      </UserMessage.Gallery>
      Use any of these as inspiration for the hero.
    </UserMessage>
  ),
  args: {},
};

export const MixedAttachments: Story = {
  name: 'Mixed images and files',
  parameters: {
    docs: {
      description: {
        story:
          'Gallery auto-switches to a vertical `@ux/list-item` stack — framed by a single `@ux/box elevation="card"` so the rows read as flush slats — whenever any file tile is present. Image thumbnails and file-type icons share a 64px-square media rail so the filename captions align at a common inline-start edge. File-type icons are inferred from the filename extension (e.g. `.docx` → `word`, `.xlsx` → `excel`) with `attachment` as the fallback.',
      },
    },
  },
  render: (args) => (
    <UserMessage {...args}>
      <UserMessage.Gallery>
        <UserMessage.Image src={SAMPLE_IMAGE} alt={SAMPLE_IMAGE_ALT} />
        <UserMessage.File name="requirements.pdf" />
        <UserMessage.File name="brand-guidelines.docx" />
        <UserMessage.File name="budget.xlsx" />
        <UserMessage.File name="pitch-deck.pptx" />
        <UserMessage.File name="assets.zip" />
      </UserMessage.Gallery>
      Use the image as the hero and follow the brand guidelines.
    </UserMessage>
  ),
  args: {},
};

export const FilesOnly: Story = {
  name: 'Files only',
  parameters: {
    docs: {
      description: {
        story:
          'Files-only galleries also use the vertical list layout — icons are inferred from each filename extension.',
      },
    },
  },
  render: (args) => (
    <UserMessage {...args}>
      <UserMessage.Gallery>
        <UserMessage.File name="requirements.pdf" />
        <UserMessage.File name="a-very-long-file-name-that-wraps.md" />
        <UserMessage.File name="kickoff-notes.rtf" />
        <UserMessage.File name="build.sh" />
      </UserMessage.Gallery>
      Here are the specs I want to follow.
    </UserMessage>
  ),
  args: {},
};

export const Rtl: Story = {
  name: 'RTL (logical property mirror)',
  render: (args) => (
    <div dir="rtl" style={{ display: 'flex' }}>
      <UserMessage {...args}>ممكن تصممي صفحة هبوط؟</UserMessage>
    </div>
  ),
  args: {},
};
