/**
 * @vitest-environment jsdom
 */
/* global CustomEvent, MessageEvent */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FormatOverrideControls from '../FormatOverrideControls';
import { safePostMessage } from '../../utils/postMessage';
import { FormatOverrideMessageEventType, addFormatOverrideEditListener } from '../../utils/formatOverrideMessages';

vi.mock('../../utils/postMessage', () => ({ safePostMessage: vi.fn() }));
vi.mock('../../utils/translations', () => ({ t: vi.fn((_: string, fallback: string) => fallback) }));
vi.mock('../../utils/text-editing-helpers', () => ({ extractThemeColors: vi.fn(() => ['#123abc']) }));
vi.mock('../ColorPicker', () => ({
  default: vi.fn(({ children, onChangeEnd }: { children?: ReactNode; onChangeEnd?: (hex: string) => void }) => (
    <>
      <button onClick={() => onChangeEnd?.('#123abc')}>commit bound color</button>
      {children}
    </>
  )),
}));
vi.mock('../../utils/formatOverrideMessages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/formatOverrideMessages')>();
  return {
    ...actual,
    addFormatOverrideEditListener: vi.fn(() => 'commit-123'),
  };
});

const expressionHash = `sha256:${'a'.repeat(64)}`;

function makeBoundElement(): HTMLElement {
  const element = document.createElement('h1');
  element.textContent = 'Title';
  element.setAttribute('data-dev-id', 'abc123');
  element.setAttribute('data-dev-file', '/app/src/pages/index.tsx');
  element.setAttribute('data-dev-bound-text', 'true');
  element.setAttribute('data-dev-bound-source-kind', 'bound-expression');
  element.setAttribute('data-dev-bound-expression-hash', expressionHash);
  document.body.appendChild(element);
  return element;
}

describe('FormatOverrideControls', () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('posts FORMAT_OVERRIDE_UPDATED when bold is toggled', () => {
    const element = makeBoundElement();
    render(<FormatOverrideControls selectedElement={element} colorMenu={{ isOpen: false, onOpenChange: vi.fn() }} />);

    fireEvent.click(screen.getByTitle('Toggle bold'));

    expect(element.style.fontWeight).toBe('700');
    expect(safePostMessage).toHaveBeenCalledWith(window.parent, {
      type: 'FORMAT_OVERRIDE_UPDATED',
      data: {
        commitId: 'commit-123',
        devId: 'abc123',
        target: {
          file: 'src/pages/index.tsx',
          tagName: 'h1',
          sourceKind: 'bound-expression',
          contentKey: null,
          contentKeyTemplate: null,
          expressionHash,
        },
        marks: { bold: true, italic: false, color: null },
      },
    });
  });

  it('preserves existing marks when italic is toggled', () => {
    const element = makeBoundElement();
    element.innerHTML = '<span data-airo-formatted-bound-text="true" data-airo-format-bold="true" data-airo-format-color="#123abc">Title</span>';
    const formatted = element.querySelector('[data-airo-formatted-bound-text]') as HTMLElement;
    render(<FormatOverrideControls selectedElement={element} colorMenu={{ isOpen: false, onOpenChange: vi.fn() }} />);

    fireEvent.click(screen.getByTitle('Toggle italic'));

    expect(formatted.style.fontStyle).toBe('italic');
    expect(safePostMessage).toHaveBeenCalledWith(window.parent, expect.objectContaining({
      type: 'FORMAT_OVERRIDE_UPDATED',
      data: expect.objectContaining({
        marks: { bold: true, italic: true, color: '#123abc' },
      }),
    }));
  });

  it('preserves existing marks when color is changed', () => {
    const element = makeBoundElement();
    element.innerHTML = '<span data-airo-formatted-bound-text="true" data-airo-format-bold="true" data-airo-format-italic="true">Title</span>';
    render(<FormatOverrideControls selectedElement={element} colorMenu={{ isOpen: true, onOpenChange: vi.fn() }} />);

    fireEvent.click(screen.getByText('commit bound color'));

    expect(safePostMessage).toHaveBeenCalledWith(window.parent, expect.objectContaining({
      type: 'FORMAT_OVERRIDE_UPDATED',
      data: expect.objectContaining({
        marks: { bold: true, italic: true, color: '#123abc' },
      }),
    }));
  });

  it('posts color null when an existing color override is cleared', () => {
    const element = makeBoundElement();
    element.innerHTML = '<span data-airo-formatted-bound-text="true" data-airo-format-bold="true" data-airo-format-color="#123abc">Title</span>';
    const formatted = element.querySelector('[data-airo-formatted-bound-text]') as HTMLElement;
    formatted.style.color = '#123abc';
    render(<FormatOverrideControls selectedElement={element} colorMenu={{ isOpen: true, onOpenChange: vi.fn() }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear text color' }));

    expect(formatted.style.color).toBe('');
    expect(safePostMessage).toHaveBeenCalledWith(window.parent, expect.objectContaining({
      type: 'FORMAT_OVERRIDE_UPDATED',
      data: expect.objectContaining({
        marks: { bold: true, italic: false, color: null },
      }),
    }));
  });

  it('rolls back optimistic marks when the edit fails', () => {
    const element = makeBoundElement();
    let handler: ((event: MessageEvent) => void) | null = null;
    vi.mocked(addFormatOverrideEditListener).mockImplementationOnce((nextHandler) => {
      handler = nextHandler;
      return 'commit-rollback';
    });
    render(<FormatOverrideControls selectedElement={element} colorMenu={{ isOpen: false, onOpenChange: vi.fn() }} />);

    fireEvent.click(screen.getByTitle('Toggle bold'));
    expect(element.style.fontWeight).toBe('700');
    expect(safePostMessage).toHaveBeenLastCalledWith(window.parent, expect.objectContaining({
      data: expect.objectContaining({ marks: { bold: true, italic: false, color: null } }),
    }));

    act(() => {
      handler?.({
        data: { type: FormatOverrideMessageEventType.EDIT_FAILED },
      } as MessageEvent);
    });

    expect(element.style.fontWeight).toBe('');
    vi.mocked(safePostMessage).mockClear();
    fireEvent.click(screen.getByTitle('Toggle bold'));

    expect(safePostMessage).toHaveBeenLastCalledWith(window.parent, expect.objectContaining({
      data: expect.objectContaining({ marks: { bold: true, italic: false, color: null } }),
    }));
  });

  it('rolls back optimistic marks when the edit reply times out', () => {
    const element = makeBoundElement();
    let onTimeout: (() => void) | undefined;
    vi.mocked(addFormatOverrideEditListener).mockImplementationOnce((_nextHandler, nextTimeout) => {
      onTimeout = nextTimeout;
      return 'commit-timeout';
    });
    render(<FormatOverrideControls selectedElement={element} colorMenu={{ isOpen: false, onOpenChange: vi.fn() }} />);

    fireEvent.click(screen.getByTitle('Toggle bold'));
    expect(element.style.fontWeight).toBe('700');

    act(() => {
      onTimeout?.();
    });

    expect(element.style.fontWeight).toBe('');
    vi.mocked(safePostMessage).mockClear();
    fireEvent.click(screen.getByTitle('Toggle bold'));

    expect(safePostMessage).toHaveBeenLastCalledWith(window.parent, expect.objectContaining({
      data: expect.objectContaining({ marks: { bold: true, italic: false, color: null } }),
    }));
  });

  it('keeps optimistic marks when the edit succeeds', () => {
    const element = makeBoundElement();
    let handler: ((event: MessageEvent) => void) | null = null;
    vi.mocked(addFormatOverrideEditListener).mockImplementationOnce((nextHandler) => {
      handler = nextHandler;
      return 'commit-success';
    });
    render(<FormatOverrideControls selectedElement={element} colorMenu={{ isOpen: false, onOpenChange: vi.fn() }} />);

    fireEvent.click(screen.getByTitle('Toggle bold'));

    act(() => {
      handler?.({
        data: { type: FormatOverrideMessageEventType.EDIT_SUCCEEDED },
      } as MessageEvent);
    });

    vi.mocked(safePostMessage).mockClear();
    fireEvent.click(screen.getByTitle('Toggle italic'));

    expect(safePostMessage).toHaveBeenLastCalledWith(window.parent, expect.objectContaining({
      data: expect.objectContaining({ marks: { bold: true, italic: true, color: null } }),
    }));
  });

  it('ignores failure replies for superseded optimistic marks', () => {
    const element = makeBoundElement();
    const handlers: Array<(event: MessageEvent) => void> = [];
    vi.mocked(addFormatOverrideEditListener)
      .mockImplementationOnce((nextHandler) => {
        handlers.push(nextHandler);
        return 'commit-bold';
      })
      .mockImplementationOnce((nextHandler) => {
        handlers.push(nextHandler);
        return 'commit-italic';
      });
    render(<FormatOverrideControls selectedElement={element} colorMenu={{ isOpen: false, onOpenChange: vi.fn() }} />);

    fireEvent.click(screen.getByTitle('Toggle bold'));
    fireEvent.click(screen.getByTitle('Toggle italic'));

    expect(safePostMessage).toHaveBeenLastCalledWith(window.parent, expect.objectContaining({
      data: expect.objectContaining({ marks: { bold: true, italic: true, color: null } }),
    }));

    act(() => {
      handlers[0]?.({
        data: { type: FormatOverrideMessageEventType.EDIT_FAILED },
      } as MessageEvent);
    });

    expect(screen.getByTitle('Toggle bold').style.color).toBe('rgb(37, 99, 235)');
    expect(screen.getByTitle('Toggle italic').style.color).toBe('rgb(37, 99, 235)');

    vi.mocked(safePostMessage).mockClear();
    fireEvent.click(screen.getByTitle('Toggle italic'));

    expect(safePostMessage).toHaveBeenLastCalledWith(window.parent, expect.objectContaining({
      data: expect.objectContaining({ marks: { bold: true, italic: false, color: null } }),
    }));
  });

  it('clears optimistic styles before the runtime sidecar update renders', () => {
    const element = makeBoundElement();
    render(<FormatOverrideControls selectedElement={element} colorMenu={{ isOpen: false, onOpenChange: vi.fn() }} />);

    fireEvent.click(screen.getByTitle('Toggle bold'));
    expect(element.style.fontWeight).toBe('700');

    act(() => {
      window.dispatchEvent(new CustomEvent('airo-format-overrides:will-update'));
    });

    expect(element.style.fontWeight).toBe('');
  });
});
