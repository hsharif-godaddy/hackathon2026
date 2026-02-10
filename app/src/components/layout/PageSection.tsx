export default function PageSection({
  children,
  allowOverflow = false,
  id
}: {
  children: React.ReactNode
  allowOverflow?: boolean
  id?: string
}) {
  return (
    <div
      id={id}
      className={`relative mx-auto px-2 sm:px-3 lg:px-4 py-4 md:py-8 lg:py-14 ${allowOverflow ? 'overflow-visible' : ''}`}
    >
      {children}
    </div>
  )
}
