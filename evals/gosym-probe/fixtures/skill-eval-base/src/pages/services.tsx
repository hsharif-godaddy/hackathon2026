const SERVICES = [
  {
    title: 'Routine Cleanings',
    description:
      'Professional teeth cleaning to remove plaque and tartar build-up. ' +
      'Recommended every six months to maintain optimal oral health.',
  },
  {
    title: 'Fillings',
    description:
      'Tooth-colored composite fillings that blend naturally with your smile. ' +
      'We treat cavities at any stage to prevent further decay.',
  },
  {
    title: 'Teeth Whitening',
    description:
      'In-office whitening treatment for a brighter, more confident smile. ' +
      'Results visible in a single appointment.',
  },
  {
    title: 'X-Rays & Diagnostics',
    description:
      'Digital X-rays with reduced radiation exposure for accurate diagnosis ' +
      'of hidden decay, bone loss, and other concerns.',
  },
  {
    title: 'Extractions',
    description:
      'Simple and surgical extractions performed with local anesthesia for ' +
      'maximum comfort. Wisdom teeth removal available.',
  },
];

export default function ServicesPage() {
  return (
    <main className="max-w-4xl mx-auto py-16 px-4">
      <h1 className="text-3xl font-bold text-blue-800 mb-4">Our Services</h1>
      <p className="text-gray-600 mb-10">
        We offer a comprehensive range of dental treatments for patients of all ages.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {SERVICES.map((service) => (
          <div key={service.title} className="border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-blue-700 mb-2">{service.title}</h2>
            <p className="text-gray-600">{service.description}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
