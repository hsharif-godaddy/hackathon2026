export default function PageSection({
  children,
  allowOverflow = false
}: {
  children: React.ReactNode
  allowOverflow?: boolean
}) {
  return (
    <div className={`relative mx-auto px-2 sm:px-3 lg:px-4 py-4 md:py-8 lg:py-14 ${allowOverflow ? 'overflow-visible' : ''}`}>
      {children}
    </div>
  )
}
