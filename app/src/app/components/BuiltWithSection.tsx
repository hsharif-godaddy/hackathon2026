import { SparklesIcon } from '@heroicons/react/24/outline'
import { BuiltWithSectionProps } from './types'
import Button from '@ux/button'
import Tag from '@ux/tag';

export default function BuiltWithSection({ items }: BuiltWithSectionProps) {
  const scrollToTop = () => {
    // Scroll to top of page
    window.scrollTo({ top: 0, behavior: 'smooth' })
    
    // Focus on textarea after scroll completes
    setTimeout(() => {
      const textarea = document.querySelector('textarea')
      if (textarea) {
        textarea.focus()
      }
    }, 500)
  }
  return (
    <section className="py-20 bg-intents-ux-boxLowContrast-backgroundColor">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="flex items-center justify-center mb-4">
            <SparklesIcon className="w-8 h-8 text-purple-600 mr-3" />
            <h2 className="text-4xl font-bold text-gray-900">Built with Airo</h2>
          </div>
          <p className="text-xl max-w-3xl mx-auto">
            See what others have built with our AI-powered platform. From simple landing pages to complex applications.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {items.map((item) => (
            <div
              key={item.id}
              className="group bg-intents-ux-box-backgroundColor rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border"
            >
              {/* Thumbnail Placeholder */}
              <div className="aspect-video bg-intents-ux-boxLowContrastOverlay-backgroundColor flex items-center justify-center relative overflow-hidden">
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-intents-ux-box-backgroundColor rounded-lg mx-auto mb-2 flex items-center justify-center">
                      <SparklesIcon className="w-8 h-8" />
                    </div>
                    <p className="text-sm">Thumbnail Placeholder</p>
                  </div>
                </div>
                {/* Overlay for future image */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Content */}
              <div className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <Tag emphasis="info">{item.category}</Tag>
                </div>
                <h3 className="text-xl font-semibold mb-2 group-hover:text-purple-600 transition-colors">
                  {item.title}
                </h3>
                <p className="text-sm leading-relaxed">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-16">
          <p className="text-lg mb-6">
            Ready to build your own application?
          </p>
          <Button
            design='primary'
            text='Start Building Now'
            data-partial='componentAiro'
            size='md'
            className='py-4! px-8!'
            onClick={scrollToTop}
          />
        </div>
      </div>
    </section>
  )
}
