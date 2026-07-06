import { type ComponentType, type ForwardedRef, forwardRef, type ReactElement } from 'react'
import UxText from '@ux/text'

type UxTextProxy = typeof UxText

type TextComponentProps = {
  as?: string
  forwardedAs?: string
  size?: number
  [key: string]: unknown
}

const alignedCache: Record<string, ComponentType<TextComponentProps>> = {}

function isConnectFlowHeadline(as: unknown, size: unknown): boolean {
  return as === 'heading' && typeof size === 'number' && size <= 1
}

function wrapTextElement(
  Element: ComponentType<TextComponentProps>
): ComponentType<TextComponentProps> {
  const Wrapped = forwardRef(function modalAlignedText(
    props: TextComponentProps,
    ref: ForwardedRef<HTMLElement>
  ): ReactElement {
    const resolvedAs: string | undefined = props.forwardedAs ?? props.as

    if (isConnectFlowHeadline(resolvedAs, props.size)) {
      const { forwardedAs: _forwardedAs, as: _as, size: _size, ...rest } = props
      return <Element ref={ref} {...rest} as="title" size={3} />
    }

    return <Element ref={ref} {...props} />
  })

  Wrapped.displayName = Element.displayName ?? 'ModalAlignedText'

  return Wrapped
}

/** Maps social-flows CDN hero headings to AAB @ux/modal title scale (TextLockup xl → title size 3). */
export function createModalAlignedUxText(): UxTextProxy {
  return new Proxy(() => {}, {
    get(_target: object, prop: string | symbol): ComponentType<TextComponentProps> | undefined {
      if (typeof prop !== 'string' || prop.startsWith('_')) {
        return undefined
      }

      const original: ComponentType<TextComponentProps> | undefined =
        (UxText as Record<string, ComponentType<TextComponentProps>>)[prop]

      if (!original) {
        return undefined
      }

      if (!alignedCache[prop]) {
        alignedCache[prop] = wrapTextElement(original)
      }

      return alignedCache[prop]
    },
  }) as UxTextProxy
}
