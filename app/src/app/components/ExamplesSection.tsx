import { ArrowRightIcon } from '@heroicons/react/24/outline'
import { ExamplesSectionProps } from './types'

export default function ExamplesSection({ examples, onExampleClick }: ExamplesSectionProps) {
  return (
    <div className="text-center mb-8">
      <p className="text-gray-500 mb-4 text-sm">Or try one of these popular examples:</p>
      <div className="flex flex-wrap justify-center gap-3 max-w-4xl mx-auto">
        {examples.map((example) => (
          <button
            key={example.title}
            onClick={() => onExampleClick(example.prompt)}
            className="group px-4 py-2 bg-white rounded-lg border border-gray-200 hover:border-purple-300 hover:shadow-md transition-all duration-200 text-sm cursor-pointer"
          >
            <span className="font-medium text-gray-700 group-hover:text-purple-600 transition-colors">
              {example.title}
            </span>
            <ArrowRightIcon className="w-3 h-3 ml-1 inline opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    </div>
  )
}
