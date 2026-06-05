import { Connection } from '@/types/inbox/local/connection'
import {
  BasicEntity,
  EmailString,
  IntString,
  PhoneString,
  UrlString,
} from './core'

interface NativeUser extends BasicEntity {
  readonly name: string
  readonly avatar?: UrlString
  readonly initials?: string
  readonly email?: EmailString
  readonly phone?: PhoneString
  readonly facebook?: IntString
  readonly instagram?: string
  readonly isC1: boolean
  readonly isBot: boolean
  readonly isC2: boolean
  readonly isGuideBot: boolean
  readonly isSystem: boolean
  readonly isDeleted: boolean
}

export interface LocalUser extends NativeUser {
  readonly connection: undefined
}

export interface GlobalUser extends NativeUser {
  readonly connection: Connection
}

export type User = LocalUser | GlobalUser