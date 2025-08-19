import React from 'react'
import GeometricLoader from './components/GeometricLoader'

export const dynamic = 'force-dynamic'

export default function Home() {
  return (
    <main className="min-h-screen p-4 space-y-8">
      <div className="flex flex-col items-center justify-center py-20">
        <GeometricLoader />
      </div>
    </main>
  )
}
