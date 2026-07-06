/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockTextElement = vi.fn(function mockTextElement(props: Record<string, unknown>) {
  return (
    <span
      data-testid="ux-text"
      data-as={String(props.as ?? '')}
      data-size={String(props.size ?? '')}
    />
  )
})

vi.mock('@ux/text', () => ({
  default: new Proxy(() => {}, {
    get(_target: object, prop: string) {
      if (prop === 'span') return mockTextElement
      return undefined
    },
  }),
}))

import { createModalAlignedUxText } from '@/app/[market]/develop/components/social/connect-flow/createModalAlignedUxText'

describe('createModalAlignedUxText', () => {
  it('remaps connect-flow hero headings to modal title scale', () => {
    const Text = createModalAlignedUxText()
    const TextSpan = Text.span

    render(<TextSpan forwardedAs="heading" size={1} text="Connect your account" />)

    expect(screen.getByTestId('ux-text')).toHaveAttribute('data-as', 'title')
    expect(screen.getByTestId('ux-text')).toHaveAttribute('data-size', '3')
  })

  it('passes through non-headline text unchanged', () => {
    const Text = createModalAlignedUxText()
    const TextSpan = Text.span

    render(<TextSpan as="paragraph" size={0} text="Body copy" />)

    expect(screen.getByTestId('ux-text')).toHaveAttribute('data-as', 'paragraph')
    expect(screen.getByTestId('ux-text')).toHaveAttribute('data-size', '0')
  })
})
