import DemoContent from '../components/DemoContent'

/**
 * Home page component
 *
 * Displays the main landing page with theme-aware demo content.
 * The layout (header/footer) is handled by RootLayout in App.tsx.
 * 
 * The DemoContent component showcases theme colors and can be easily
 * replaced when building actual site content.
 */
export default function HomePage() {
  return <DemoContent />
}
