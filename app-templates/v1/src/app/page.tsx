export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex">
        <h1 className="text-4xl font-bold text-center">
          Welcome to Your New App!
        </h1>
      </div>
      
      <div className="relative flex place-items-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-4">
            Built with Airo AI Builder
          </h2>
          <p className="text-lg text-gray-600 max-w-md">
            This app was created from a template. Start building your amazing application!
          </p>
        </div>
      </div>

      <div className="mb-32 grid text-center lg:max-w-5xl lg:w-full lg:mb-0 lg:grid-cols-4 lg:text-left">
        <div className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100">
          <h3 className="mb-3 text-2xl font-semibold">
            Docs{' '}
            <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
              →
            </span>
          </h3>
          <p className="m-0 max-w-[30ch] text-sm opacity-50">
            Find in-depth information about your app&apos;s features and API.
          </p>
        </div>

        <div className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100">
          <h3 className="mb-3 text-2xl font-semibold">
            Learn{' '}
            <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
              →
            </span>
          </h3>
          <p className="m-0 max-w-[30ch] text-sm opacity-50">
            Learn about Airo AI Builder with a guided tutorial!
          </p>
        </div>

        <div className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100">
          <h3 className="mb-3 text-2xl font-semibold">
            Templates{' '}
            <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
              →
            </span>
          </h3>
          <p className="m-0 max-w-[30ch] text-sm opacity-50">
            Explore starter templates for Airo AI Builder.
          </p>
        </div>

        <div className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100">
          <h3 className="mb-3 text-2xl font-semibold">
            Deploy{' '}
            <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
              →
            </span>
          </h3>
          <p className="m-0 max-w-[30ch] text-sm opacity-50">
            Instantly deploy your app with Vercel, Netlify, or your favorite platform.
          </p>
        </div>
      </div>
    </main>
  )
}
