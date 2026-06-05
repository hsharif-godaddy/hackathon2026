export type UuidString = string
export type IntString = string
export type IsoDateTimeString = string
export type MediaTypeString = string
export type UrlString = string
export type EmailString = string
export type PhoneString = string

export type Nullable<T> = T | null
export type Optional<T> = T | undefined

export interface Entity<T extends number | IntString | UuidString> {
  readonly id: T
}

export type BasicEntity = Entity<number>

export interface SortableEntity<T extends number | IntString | UuidString>
  extends Entity<T> {
  readonly bumpedAt: IsoDateTimeString
}

export interface TrackedEntity<T extends number | IntString | UuidString>
  extends SortableEntity<T> {
  readonly createdAt: IsoDateTimeString
  readonly updatedAt: IsoDateTimeString
}

export interface DataEntity extends TrackedEntity<IntString> {
  readonly brandId?: UuidString
  readonly originId?: string
}