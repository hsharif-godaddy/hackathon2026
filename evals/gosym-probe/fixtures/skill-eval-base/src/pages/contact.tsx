export default function ContactPage() {
  return (
    <main className="max-w-4xl mx-auto py-16 px-4">
      <h1 className="text-3xl font-bold text-blue-800 mb-10">Contact Us</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        <section>
          <h2 className="text-xl font-semibold text-blue-700 mb-4">Get in Touch</h2>
          <dl className="space-y-4 text-gray-700">
            <div>
              <dt className="font-semibold">Address</dt>
              <dd>123 Maple Street, Suite 200<br />Springfield, IL 62701</dd>
            </div>
            <div>
              <dt className="font-semibold">Phone</dt>
              <dd>(555) 867-5309</dd>
            </div>
            <div>
              <dt className="font-semibold">Hours</dt>
              <dd>
                Mon–Fri: 8 AM – 6 PM<br />
                Sat: 9 AM – 2 PM<br />
                Sun: Closed
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-blue-700 mb-4">Send Us a Message</h2>
          {/* Placeholder form — no backend wired */}
          <form action="#" className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                id="name"
                type="text"
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Your name"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
                Message
              </label>
              <textarea
                id="message"
                rows={4}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="How can we help?"
              />
            </div>
            <button
              type="submit"
              className="bg-blue-700 text-white px-6 py-2 rounded-md hover:bg-blue-800 transition-colors"
            >
              Send Message
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
