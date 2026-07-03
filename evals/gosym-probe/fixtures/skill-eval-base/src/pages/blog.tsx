const ARTICLES = [
  {
    slug: 'five-tips-healthier-teeth',
    title: '5 Tips for Healthier Teeth',
    excerpt:
      'Small daily habits make a big difference. Discover five evidence-backed ' +
      'practices that keep your teeth strong and your gums healthy.',
  },
  {
    slug: 'why-regular-cleanings-matter',
    title: 'Why Regular Cleanings Matter',
    excerpt:
      'Skipping your bi-annual cleaning might seem harmless, but plaque and ' +
      'tartar build-up can lead to serious — and costly — dental issues.',
  },
  {
    slug: 'understanding-dental-x-rays',
    title: 'Understanding Dental X-Rays',
    excerpt:
      'Modern digital X-rays expose patients to far less radiation than you ' +
      'might think. Learn what dentists look for and why they matter.',
  },
];

export default function BlogPage() {
  return (
    <main className="max-w-4xl mx-auto py-16 px-4">
      <h1 className="text-3xl font-bold text-blue-800 mb-4">Dental Health Blog</h1>
      <p className="text-gray-600 mb-10">
        Tips, insights, and news from the Bright Smiles team.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {ARTICLES.map((article) => (
          <article key={article.slug} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-blue-100 h-40" />
            <div className="p-5">
              <h2 className="font-semibold text-blue-800 mb-2">{article.title}</h2>
              <p className="text-gray-600 text-sm mb-4">{article.excerpt}</p>
              <a
                href={`#${article.slug}`}
                className="text-blue-600 text-sm font-medium hover:underline"
              >
                Read More
              </a>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
