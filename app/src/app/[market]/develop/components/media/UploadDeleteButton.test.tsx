/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { UploadDeleteButton } from './UploadDeleteButton'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (_key: string, _values?: unknown, fallback?: string) => fallback ?? _key,
}))
// Pass className/props straight through so we can assert the visibility classes.
vi.mock('@ux/button', () => ({
  default: ({ icon, ...props }: { icon?: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{icon}</button>
  ),
}))
vi.mock('@ux/icon/trash', () => ({
  default: () => <svg data-testid="trash-icon" />,
}))

describe('UploadDeleteButton', () => {
  it('is hidden until hover/focus by default', () => {
    render(<UploadDeleteButton filename="dog.jpg" onDelete={vi.fn()} />)
    const button: HTMLElement = screen.getByTestId('uploaded-image-delete-dog.jpg')
    expect(button.className).toContain('opacity-0')
    expect(button.className).toContain('group-hover:opacity-100')
    expect(button.className).toContain('focus-visible:opacity-100')
  })

  it('is forced visible when revealed (mobile long-press)', () => {
    render(<UploadDeleteButton filename="dog.jpg" onDelete={vi.fn()} revealed />)
    const button: HTMLElement = screen.getByTestId('uploaded-image-delete-dog.jpg')
    expect(button.className).toContain('opacity-100')
  })

  it('invokes onDelete with the filename', () => {
    const onDelete = vi.fn()
    render(<UploadDeleteButton filename="dog.jpg" onDelete={onDelete} />)
    screen.getByTestId('uploaded-image-delete-dog.jpg').click()
    expect(onDelete).toHaveBeenCalledWith('dog.jpg')
  })
})
