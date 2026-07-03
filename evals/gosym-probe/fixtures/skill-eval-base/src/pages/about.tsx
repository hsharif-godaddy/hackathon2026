export default function AboutPage() {
  return (
    <main className="max-w-4xl mx-auto py-16 px-4">
      <h1 className="text-3xl font-bold text-blue-800 mb-6">About Our Practice</h1>

      <section className="mb-12">
        <h2 className="text-xl font-semibold text-blue-700 mb-4">Our History</h2>
        <p className="text-gray-700 mb-4">
          Bright Smiles Dental Practice was founded in 2004 with a single mission: to provide
          high-quality, compassionate dental care to families in the community. What started as
          a two-chair office has grown into a full-service practice serving hundreds of patients
          each month.
        </p>
        <p className="text-gray-700">
          Over the years we have expanded our services to include cosmetic dentistry, orthodontics,
          and emergency care — all under one roof.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-blue-700 mb-6">Meet the Team</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { name: 'Dr. Sarah Chen', role: 'Lead Dentist' },
            { name: 'Dr. Marcus Webb', role: 'Orthodontist' },
            { name: 'Dr. Priya Nair', role: 'Cosmetic Specialist' },
          ].map((member) => (
            <div key={member.name} className="border border-gray-200 rounded-lg p-6 text-center">
              <div className="w-20 h-20 bg-blue-100 rounded-full mx-auto mb-4" />
              <h3 className="font-semibold text-gray-800">{member.name}</h3>
              <p className="text-blue-600 text-sm">{member.role}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
