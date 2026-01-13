import type { Components } from 'react-markdown';

/**
 * Custom component styles for ReactMarkdown rendering
 * Uses UXCore design tokens for consistent styling with the builder UI
 */
export const markdownComponents: Components = {
  h1: ({ ...props }) => <h1 className="text-3xl font-bold mt-4 mb-3" {...props} />,
  h2: ({ ...props }) => <h2 className="text-2xl font-bold mt-4 mb-2" {...props} />,
  h3: ({ ...props }) => <h3 className="text-xl font-semibold mt-3 mb-2" {...props} />,
  h4: ({ ...props }) => <h4 className="text-lg font-semibold mt-3 mb-2" {...props} />,
  h5: ({ ...props }) => <h5 className="text-base font-semibold mt-2 mb-1" {...props} />,
  h6: ({ ...props }) => <h6 className="text-sm font-semibold mt-2 mb-1" {...props} />,
  p: ({ ...props }) => <p className="mb-3 leading-relaxed" {...props} />,
  a: ({ ...props }) => <a className="text-intents-ux-feedbackInfo-feedbackColor hover:underline underline" {...props} />,
  ul: ({ ...props }) => <ul className="list-disc list-inside mb-3 space-y-1" {...props} />,
  ol: ({ ...props }) => <ol className="list-decimal list-inside mb-3 space-y-1" {...props} />,
  li: ({ ...props }) => <li className="ml-4" {...props} />,
  blockquote: ({ ...props }) => <blockquote className="border-l-4 border-intents-ux-boxLowContrast-borderColor pl-4 italic my-3 opacity-80" {...props} />,
  code: ({ ...props }) => {
    const isInline = !props.className?.includes('language-');
    return isInline
      ? <code className="bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-feedbackCritical-feedbackColor px-1.5 py-0.5 rounded text-sm font-mono" {...props} />
      : <code className="block bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-color p-4 rounded-lg overflow-x-auto my-3 text-sm font-mono" {...props} />;
  },
  pre: ({ ...props }) => <pre className="bg-intents-ux-boxHighContrast-backgroundColor rounded-lg overflow-x-auto my-3" {...props} />,
  table: ({ ...props }) => <div className="overflow-x-auto my-3"><table className="min-w-full border-collapse border border-intents-ux-boxLowContrast-borderColor" {...props} /></div>,
  thead: ({ ...props }) => <thead className="bg-intents-ux-boxLowContrast-backgroundColor" {...props} />,
  tbody: ({ ...props }) => <tbody {...props} />,
  tr: ({ ...props }) => <tr className="border-b border-intents-ux-boxLowContrast-borderColor" {...props} />,
  th: ({ ...props }) => <th className="border border-intents-ux-boxLowContrast-borderColor px-4 py-2 text-left font-semibold" {...props} />,
  td: ({ ...props }) => <td className="border border-intents-ux-boxLowContrast-borderColor px-4 py-2" {...props} />,
  hr: ({ ...props }) => <hr className="my-6 border-intents-ux-boxLowContrast-borderColor" {...props} />,
  img: ({ ...props }) => <img className="max-w-full h-auto rounded-lg my-3" {...props} />,
};
