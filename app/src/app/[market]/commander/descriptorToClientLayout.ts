import type { BuilderLayoutDescriptor } from '@airo/shared'

import { BuilderLayout } from './types'

export function descriptorToClientLayout(
  descriptor: BuilderLayoutDescriptor,
  base: BuilderLayout,
): BuilderLayout {
  switch (descriptor.layout) {
    case 'immersive':
      return BuilderLayout.Immersive
    case 'commander':
      return BuilderLayout.Commander
    case 'develop':
      return BuilderLayout.Develop
    case 'default':
      return base
  }
}
