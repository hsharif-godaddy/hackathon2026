import { EmailString, PhoneString, TrackedEntity, UuidString } from '@/types/inbox/local/core'

export interface Connection extends TrackedEntity<UuidString> {
  readonly name?: string
  readonly defaultEmail?: EmailString
  readonly emails?: ReadonlyArray<EmailString>
  readonly defaultPhone?: PhoneString
  readonly phones?: ReadonlyArray<PhoneString>
  readonly addresses?: ReadonlyArray<string>
  readonly notes?: string
  readonly isCustomer: boolean
  readonly isMember: boolean
  readonly isSubscriber: boolean
}
