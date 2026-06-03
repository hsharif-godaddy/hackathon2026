import figma from '@figma/code-connect';
import { PanelChrome } from './PanelChrome';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=176-143
figma.connect(
  PanelChrome,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=176-143',
  {
    props: {
      title: figma.string('title'),
      dragHandleLabel: figma.string('dragHandleLabel'),
      closeLabel: figma.string('closeLabel'),
      // Figma `Show Header` boolean ↔ stickyHeader OFF (header collapsed
      // out of view by the runtime hide-on-scroll).
      stickyHeader: figma.boolean('Show Header'),
      // The Figma Draggable boolean is presentational — the runtime drag
      // handle is supplied by the caller (FloatingPanel) via dragHandle,
      // not a Panel Chrome prop.
      headerChrome: figma.enum('headerChrome', {
        default: 'default',
        ghost: 'ghost',
      }),
      // Figma `Footer` boolean ↔ presence of the React `footer` slot.
      hideFooter: figma.enum('Footer', {
        true: false,
        false: true,
      }),
    },
    example: ({ title, dragHandleLabel, closeLabel, stickyHeader, headerChrome, hideFooter }) => (
      <PanelChrome
        title={title}
        dragHandleLabel={dragHandleLabel}
        closeLabel={closeLabel}
        stickyHeader={stickyHeader}
        headerChrome={headerChrome}
        hideFooter={hideFooter}
        onClose={() => {}}
      >
        <p>Body content.</p>
      </PanelChrome>
    ),
  },
);
