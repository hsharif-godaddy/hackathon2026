import { SparklesIcon } from '@heroicons/react/24/outline'
import { BuiltWithSectionProps } from './types'

export default function BuiltWithSection({ items }: BuiltWithSectionProps) {
  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="flex items-center justify-center mb-4">
            <SparklesIcon className="w-8 h-8 text-purple-600 mr-3" />
            <h2 className="text-4xl font-bold text-gray-900">Built with Airo</h2>
          </div>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            See what others have built with our AI-powered platform. From simple landing pages to complex applications.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {items.map((item) => (
            <div
              key={item.id}
              className="group bg-white rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-200 hover:border-purple-200"
            >
              {/* Thumbnail Placeholder */}
              <div className="aspect-video bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center relative overflow-hidden">
                <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gray-300 rounded-lg mx-auto mb-2 flex items-center justify-center">
                      <SparklesIcon className="w-8 h-8 text-gray-500" />
                    </div>
                    <p className="text-sm text-gray-500">Thumbnail Placeholder</p>
                  </div>
                </div>
                {/* Overlay for future image */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Content */}
              <div className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="inline-block px-3 py-1 text-xs font-semibold text-purple-600 bg-purple-100 rounded-full">
                    {item.category}
                  </span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2 group-hover:text-purple-600 transition-colors">
                  {item.title}
                </h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-16">
          <p className="text-lg text-gray-600 mb-6">
            Ready to build your own application?
          </p>
          <button className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-8 py-3 rounded-xl hover:from-purple-700 hover:to-blue-700 transition-all text-lg font-semibold shadow-lg hover:shadow-xl">
            Start Building Now
          </button>
        </div>
      </div>
    </section>
  )
}
