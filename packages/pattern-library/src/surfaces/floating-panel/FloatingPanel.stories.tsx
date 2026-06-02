import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import TextLockup from '@ux/text-lockup';
import { useRef, useState } from 'react';

import type { FloatingPanelDockedTo } from './FloatingPanel';

import { PromptBox } from '../../input/prompt-box';
import { AiroHeader } from '../panel-chrome';
import { FloatingPanel } from './index';
import '../../input/prompt-box/styles.css';
import './styles.css';
import '../panel-chrome/styles.css';

/**
 * `FloatingPanel` is a draggable, resizable, viewport-constrained chat
 * window. It mounts in a React portal (`document.body`), does not render a
 * scrim, and wraps `PanelChrome` for the inner UI.
 *
 * Click **"Open panel"** in each story to see the floating panel appear.
 * Drag by the header; resize from any edge or corner.
 */
const meta: Meta<typeof FloatingPanel> = {
  title: 'Surfaces / FloatingPanel',
  component: FloatingPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Draggable, resizable, non-modal chat window. Composes `react-rnd` (drag + resize) and `PanelChrome` (inner UI). Mounts via a React portal so it floats above page content.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof FloatingPanel>;

// ─── Launcher wrapper ─────────────────────────────────────────────────────
// FloatingPanel is portal-rendered and not visible in Storybook's centered
// layout without a launcher button. Each story wraps in a simple
// show/hide toggle so the panel appears in the actual viewport.

function Launcher({ children }: { children: React.ReactNode }) {
  return (
    <Box inlinePadding="xl" blockPadding="xl">
      <TextLockup title="Page content behind the panel" />
      <TextLockup>
        Open the panel, then drag it by the header and resize from any edge or corner.
      </TextLockup>
      {children}
    </Box>
  );
}

// ─── Default ─────────────────────────────────────────────────────────────

export const Default: Story = {
  name: 'Default (uncontrolled)',
  render: () => <DefaultDemo />,
};

function DefaultDemo() {
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <Launcher>
      <Button
        design="secondary"
        text={show ? 'Close panel' : 'Open panel'}
        onClick={() => setShow((v) => !v)}
      />
      <FloatingPanel
        show={show}
        onClose={() => setShow(false)}
        title="Airo"
        expanded={expanded}
        onExpandedChange={setExpanded}
        footer={<PromptBox placeholder="Type a message…" />}
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>
            Drag this panel by the header. Resize from any edge or corner. Click the expand button
            to fill the viewport. Press Escape or the close button to dismiss.
          </TextLockup>
        </Box>
      </FloatingPanel>
    </Launcher>
  );
}

// ─── Expand to full screen ────────────────────────────────────────────────

/**
 * The panel opens directly in full-screen mode. The corner button shows the
 * **collapse** icon — clicking it returns the panel to the draggable floating
 * window. The page background then shows an **Open Airo** button to expand
 * again. Docking is drag-only: drag the floating panel near a viewport edge
 * to snap it into a side panel; drag the handle pill back out to undock.
 */
export const ExpandToFullScreen: Story = {
  name: 'Expand to full screen',
  render: () => <ExpandDemo />,
};

function ExpandDemo() {
  const [expanded, setExpanded] = useState(true);

  return (
    <Box inlinePadding="xl" blockPadding="xl">
      <TextLockup title="Page content" />
      <TextLockup>
        The panel starts in full-screen mode. Click Collapse to return to the floating window, then
        use the button below to expand again. Drag near a viewport edge to dock.
      </TextLockup>

      {!expanded && (
        <Box blockPadding="md">
          <Button design="secondary" text="Open Airo" onClick={() => setExpanded(true)} />
        </Box>
      )}

      <FloatingPanel
        show
        onClose={() => {}}
        title="Airo"
        expanded={expanded}
        onExpandedChange={setExpanded}
        footer={<PromptBox placeholder="Type a message…" />}
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>
            Collapse returns the panel to the floating window at its previous position. The Expand
            button brings it back to full screen.
          </TextLockup>
        </Box>
      </FloatingPanel>
    </Box>
  );
}

// ─── Controlled position + size ───────────────────────────────────────────

export const ControlledPositionAndSize: Story = {
  name: 'Controlled position + size',
  render: () => <ControlledDemo />,
};

function ControlledDemo() {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 48, y: 48 });
  const [sz, setSz] = useState({ width: 400, height: 480 });

  return (
    <Launcher>
      <Button
        design="secondary"
        text={show ? 'Close panel' : 'Open panel'}
        onClick={() => setShow((v) => !v)}
      />
      <Box blockPadding="sm">
        <TextLockup
          title={`Position: (${pos.x}, ${pos.y}) — Size: ${sz.width} × ${sz.height}`}
          size="sm"
        />
      </Box>
      <FloatingPanel
        show={show}
        onClose={() => setShow(false)}
        position={pos}
        onPositionChange={setPos}
        size={sz}
        onSizeChange={setSz}
        title="Controlled panel"
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>
            Consumer owns position and size. The readout above updates as you drag.
          </TextLockup>
        </Box>
      </FloatingPanel>
    </Launcher>
  );
}

// ─── With AiroHeader ─────────────────────────────────────────────────────

export const WithAiroHeader: Story = {
  name: 'With AiroHeader',
  render: () => <AiroHeaderDemo />,
};

function AiroHeaderDemo() {
  const [show, setShow] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');

  const content: Record<string, string> = {
    chat: 'Chat section — conversation content lives here.',
    activity: 'Activity section — recent automations or tool calls.',
  };

  return (
    <Launcher>
      <Button
        design="secondary"
        text={show ? 'Close panel' : 'Open panel'}
        onClick={() => setShow((v) => !v)}
      />
      <FloatingPanel
        show={show}
        onClose={() => setShow(false)}
        aria-label="Airo"
        header={
          <AiroHeader
            tabs={[
              { id: 'chat', label: 'Chat' },
              { id: 'activity', label: 'Activity' },
            ]}
            activeTabId={activeTab}
            onTabChange={setActiveTab}
            onActionClick={() => {}}
            actionLabel="New conversation"
            onClose={() => setShow(false)}
          />
        }
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>{content[activeTab]}</TextLockup>
        </Box>
      </FloatingPanel>
    </Launcher>
  );
}

// ─── Constrained size ─────────────────────────────────────────────────────

export const ConstrainedSize: Story = {
  name: 'Constrained size',
  render: () => <ConstrainedDemo />,
};

function ConstrainedDemo() {
  const [show, setShow] = useState(false);
  return (
    <Launcher>
      <Button
        design="secondary"
        text={show ? 'Close panel' : 'Open panel'}
        onClick={() => setShow((v) => !v)}
      />
      <FloatingPanel
        show={show}
        onClose={() => setShow(false)}
        title="Constrained"
        minSize={{ width: 320, height: 240 }}
        maxSize={{ width: 600, height: 700 }}
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>Resize handles are capped: min 320 × 240 px, max 600 × 700 px.</TextLockup>
        </Box>
      </FloatingPanel>
    </Launcher>
  );
}

// ─── Edge snap ────────────────────────────────────────────────────────────

/**
 * Drag the panel toward either the **left** or **right** edge of the viewport.
 * When it gets within ~80 px of the edge a ghost preview appears; releasing
 * snaps it into a fixed side panel. The **Undock** button in the corner
 * actions pops it back out to floating mode.
 *
 * The `dockedTo` readout below the button shows the current mode.
 */
export const EdgeSnap: Story = {
  name: 'Edge snap (left / right)',
  render: () => <EdgeSnapDemo />,
  parameters: {
    docs: {
      description: {
        story:
          'Drag within 80 px of either viewport edge to see the snap preview. Release to dock; use the Undock button to return to floating mode.',
      },
    },
  },
};

function EdgeSnapDemo() {
  const [show, setShow] = useState(false);
  const [dockedTo, setDockedTo] = useState<FloatingPanelDockedTo>(null);

  const dockedLabel =
    dockedTo === 'left' ? 'Docked left' : dockedTo === 'right' ? 'Docked right' : 'Floating';

  return (
    <Launcher>
      <Button
        design="secondary"
        text={show ? 'Close panel' : 'Open panel'}
        onClick={() => setShow((v) => !v)}
      />
      <Box blockPadding="sm">
        <TextLockup title={dockedLabel} size="sm" />
      </Box>
      <FloatingPanel
        show={show}
        onClose={() => setShow(false)}
        dockedTo={dockedTo}
        onDock={(t) => setDockedTo(t as 'left' | 'right')}
        onUndock={() => setDockedTo(null)}
        title="Airo"
        defaultPosition={{ x: 200, y: 80 }}
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>
            Drag near the left or right edge. A ghost shows where the panel will snap. Release to
            dock; press the Undock button to float again.
          </TextLockup>
        </Box>
      </FloatingPanel>
    </Launcher>
  );
}

// ─── Drop zone ────────────────────────────────────────────────────────────

/**
 * The page reserves a sidebar slot using `FloatingPanel.DropZone`. Dragging
 * the panel over the sidebar column highlights the zone and, on release,
 * docks the panel in-page — no `position: fixed`, no scrim. Clicking Undock
 * pops it back out.
 *
 * **Best practice**: prefer a `DropZone` on wide viewports so the chat sits
 * alongside content rather than floating over it.
 */
export const DropZoneStory: Story = {
  name: 'Drop zone (in-page sidebar)',
  render: () => <DropZoneDemo />,
  parameters: {
    docs: {
      description: {
        story:
          'Page layout with a designated `FloatingPanel.DropZone` sidebar slot. The zone is invisible (zero width) until the panel is dragged near it — then it expands as a preview. Drag the panel over it to dock in-page; use the drag handle or Undock button to float again.',
      },
    },
  },
};

function DropZoneDemo() {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const [dockedTo, setDockedTo] = useState<FloatingPanelDockedTo>(null);
  const isDocked = dockedTo !== null;

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Main content */}
      <Box style={{ flex: 1, minWidth: 0 }} inlinePadding="xl" blockPadding="xl">
        <TextLockup title="Page content" />
        <TextLockup>
          Open the panel and drag it over the sidebar column on the right. The zone highlights to
          show it will accept the drop. Release to dock the panel in-page.
        </TextLockup>
        <Box blockPadding="sm">
          <Button
            design="secondary"
            text={show ? 'Close panel' : 'Open panel'}
            onClick={() => setShow((v) => !v)}
          />
        </Box>
        {isDocked && (
          <Box blockPadding="sm">
            <TextLockup title="Panel is docked in the sidebar" size="sm" />
          </Box>
        )}
      </Box>

      {/* Sidebar drop zone — collapses to 0 when empty, expands to
          --airo-fp-drop-zone-width while dragging near or docked. */}
      <FloatingPanel.DropZone
        ref={sidebarRef}
        style={{
          '--airo-fp-drop-zone-width': '360px',
          borderInlineStart: '1px solid transparent',
          minHeight: '100%',
        }}
      />

      {/* Floating panel — has access to the sidebar ref */}
      <FloatingPanel
        show={show}
        onClose={() => setShow(false)}
        dropZones={[sidebarRef]}
        dockedTo={dockedTo}
        onDock={(t) => setDockedTo(t)}
        onUndock={() => setDockedTo(null)}
        title="Airo"
        defaultPosition={{ x: 48, y: 80 }}
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>
            Drag me over the sidebar column to dock in-page. While docked I render in the normal DOM
            flow — no overlay, no fixed position.
          </TextLockup>
        </Box>
      </FloatingPanel>
    </div>
  );
}
