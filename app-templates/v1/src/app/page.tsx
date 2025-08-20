import React from 'react'
import GeometricLoader from './components/GeometricLoader'

export default function Home() {
  return (
    <main className="min-h-screen p-4">
      <div className="flex items-center justify-center py-20">
        <GeometricLoader />
      </div>
    </main>
  )
}
