import {
  BasicEntity,
  EmailString,
  IntString,
  Nullable,
  PhoneString,
  UrlString
} from '@/types/inbox/local/core'

// Enums
// https://github.com/gdcorp-enm/reamaze/blob/main/app/models/user.rb
// https://github.com/gdcorp-enm/reamaze/blob/main/app/models/login.rb

const remoteUserTypes = <const>['staff', 'customer', 'system']
export type RemoteUserType = (typeof remoteUserTypes)[number]

const remoteIdentityTypes = <const>[
  'anonymous',
  'email',
  'twitter',
  'facebook',
  'stripe',
  'instagram',
  'mobile',
  'system',
  'custom',
  'igsid',
  'gdid',
  'gdsso',
]
export type RemoteIdentityType = (typeof remoteIdentityTypes)[number]

export interface RemoteIdentity extends BasicEntity {
  label: Nullable<string>
  identifier: Nullable<string>
  type: RemoteIdentityType
}

export interface RemoteUser extends BasicEntity {
  name: string
  friendly_name: string
  avatar_url: Nullable<UrlString>
  email: Nullable<EmailString>
  mobile: Nullable<PhoneString>
  facebook: Nullable<IntString>
  instagram: Nullable<IntString>
  identities: RemoteIdentity[]
  user_type: RemoteUserType
}