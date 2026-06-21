export interface ContentEditErrorCopy {
  titleKey: string
  titleFallback: string
  bodyKey: string
  bodyFallback: string
}

export function contentEditErrorCopy(code: string | undefined): ContentEditErrorCopy {
  const title = { titleKey: 'builder_cms_edit_error_title', titleFallback: 'Change not saved' }
  switch (code) {
    case 'invalid-value':
      return { ...title, bodyKey: 'builder_cms_edit_error_invalid_number', bodyFallback: "That value couldn't be saved — enter a valid number." }
    case 'type-unsupported':
      return { ...title, bodyKey: 'builder_cms_edit_error_unsupported', bodyFallback: "This field can't be edited inline." }
    default:
      return { ...title, bodyKey: 'builder_cms_edit_error_generic', bodyFallback: "Couldn't save that change. Please try again." }
  }
}
