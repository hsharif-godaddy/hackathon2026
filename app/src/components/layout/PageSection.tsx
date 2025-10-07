export default function PageSection({
  children,
  allowOverflow = false
}: {
  children: React.ReactNode
  allowOverflow?: boolean
}) {
  return (
    <div className={`relative mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-16 lg:py-28 ${allowOverflow ? 'overflow-visible' : ''}`}>
      {children}
    </div>
  )
}
