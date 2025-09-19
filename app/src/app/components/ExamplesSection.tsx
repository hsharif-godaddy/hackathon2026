import { ArrowRightIcon } from '@heroicons/react/24/outline'
import { ExamplesSectionProps } from './types'
import { generateClickEID, logMultipleClickEvents } from '@/utils/instrumentation'

export default function ExamplesSection({ examples, onExampleClick }: ExamplesSectionProps) {
  return (
    <div className="text-center mb-8 mt-1">
      <p className="mb-4">Or try one of these popular examples:</p>
      <div className="flex flex-wrap justify-center gap-3 max-w-4xl mx-auto">
        {examples.map((example) => (
          <button
            data-eid={ generateClickEID('homepage.examples.example') }
            key={example.title}
            onClick={() => {
              onExampleClick(example.prompt);
              logMultipleClickEvents([
                'homepage.examples.example',
                `homepage.examples.example_${example.slug}`,
              ]);
            } }
            className="group px-4 py-2 rounded-lg border hover:shadow-md transition-all duration-200 text-sm cursor-pointer"
          >
            <span className="font-medium transition-colors">
              {example.title}
            </span>
            <ArrowRightIcon className="w-3 h-3 ml-1 inline opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          </button>
        ))}
      </div>
    </div>
  )
}
