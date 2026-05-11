/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import ColorPicker from '../components/ColorPicker';

beforeEach(() => {
  cleanup();
});

describe('ColorPicker', () => {
  it('renders without crashing', () => {
    const { container } = render(createElement(ColorPicker, { value: '#ff0000', onChange: vi.fn() }));
    expect(container.firstChild).not.toBeNull();
  });

  it('renders a canvas element for the SV picker', () => {
    const { container } = render(createElement(ColorPicker, { value: '#ff0000', onChange: vi.fn() }));
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
  });

  it('displays the hex value in an input', () => {
    render(createElement(ColorPicker, { value: '#3b82f6', onChange: vi.fn() }));
    const input = screen.getByDisplayValue('#3b82f6');
    expect(input).not.toBeNull();
  });

  it('calls onChange when a valid hex is typed and Enter pressed', () => {
    const onChange = vi.fn();
    render(createElement(ColorPicker, { value: '#ff0000', onChange }));
    const input = screen.getByDisplayValue('#ff0000');
    fireEvent.change(input, { target: { value: '#00ff00' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('#00ff00');
  });

  it('reverts to current value when an invalid hex is entered and blurred', () => {
    const onChange = vi.fn();
    render(createElement(ColorPicker, { value: '#ff0000', onChange }));
    const input = screen.getByDisplayValue('#ff0000');
    fireEvent.change(input, { target: { value: 'not-a-color' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('#ff0000');
  });

  it('calls onChange on blur when hex is valid and different', () => {
    const onChange = vi.fn();
    render(createElement(ColorPicker, { value: '#ff0000', onChange }));
    const input = screen.getByDisplayValue('#ff0000');
    fireEvent.change(input, { target: { value: '#0000ff' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('#0000ff');
  });

  it('normalizes shorthand hex on commit', () => {
    const onChange = vi.fn();
    render(createElement(ColorPicker, { value: '#ff0000', onChange }));
    const input = screen.getByDisplayValue('#ff0000');
    fireEvent.change(input, { target: { value: '#f0f' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('#ff00ff');
  });

  it('updates displayed hex when value prop changes', () => {
    const { rerender } = render(createElement(ColorPicker, { value: '#ff0000', onChange: vi.fn() }));
    rerender(createElement(ColorPicker, { value: '#00ff00', onChange: vi.fn() }));
    const input = screen.getByDisplayValue('#00ff00');
    expect(input).not.toBeNull();
  });

  it('calls onChange when pointer drags on hue slider', () => {
    const onChange = vi.fn();
    const { container } = render(createElement(ColorPicker, { value: '#ff0000', onChange }));

    const slider = container.querySelector('[data-testid="color-picker-hue-slider"]') as HTMLElement;
    expect(slider).not.toBeNull();

    // Simulate pointer interaction at the midpoint (hue ~180)
    const rect = { left: 0, top: 0, width: 176, height: 14, right: 176, bottom: 14 };
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
    slider.setPointerCapture = vi.fn();

    fireEvent.pointerDown(slider, { clientX: 88, clientY: 7, pointerId: 1 });

    expect(onChange).toHaveBeenCalled();
    const emittedHex = onChange.mock.calls[0][0] as string;
    // At hue ~180 (cyan area), red channel should be low
    expect(emittedHex).not.toBe('#ff0000');
  });
});
