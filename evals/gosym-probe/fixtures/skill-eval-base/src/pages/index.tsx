export default function HomePage() {
  return (
    <main>
      <section className="bg-blue-700 text-white py-24 px-4 text-center">
        <h1 className="text-4xl font-bold mb-4">Bright Smiles Dental Practice</h1>
        <p className="text-xl mb-8">
          Compassionate, professional dental care for the whole family.
        </p>
        <a
          href="https://placeholder.example.com/book"
          className="inline-block bg-white text-blue-700 font-semibold px-8 py-3 rounded-lg hover:bg-blue-50 transition-colors"
        >
          Book Appointment
        </a>
      </section>

      <section className="py-16 px-4 max-w-4xl mx-auto text-center">
        <h2 className="text-2xl font-bold text-blue-800 mb-6">Why Choose Us?</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="font-semibold text-lg mb-2">Experienced Team</h3>
            <p className="text-gray-600">Over 20 years of combined experience in family dentistry.</p>
          </div>
          <div>
            <h3 className="font-semibold text-lg mb-2">Modern Equipment</h3>
            <p className="text-gray-600">State-of-the-art tools for accurate, comfortable care.</p>
          </div>
          <div>
            <h3 className="font-semibold text-lg mb-2">Welcoming Environment</h3>
            <p className="text-gray-600">A calm, friendly office designed to ease dental anxiety.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
