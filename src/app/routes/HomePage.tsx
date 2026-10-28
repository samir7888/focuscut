import { Link } from 'react-router-dom';
import { BRAND } from '../../config/brand';
import { ThemeToggle } from '../../components/ThemeToggle';

export function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="mb-12 flex items-start justify-between">
        <div>
          <h1 className="font-display text-5xl tracking-tight mb-4">{BRAND.name}</h1>
          <p className="text-lg text-text-muted max-w-2xl">{BRAND.tagline}</p>
        </div>
        <ThemeToggle />
      </header>
      <div className="flex gap-3">
        <Link
          to="/setup"
          className="inline-flex items-center justify-center h-10 px-5 rounded-md bg-focus text-focus-ink font-medium"
        >
          Start recording
        </Link>
        <Link
          to="/library"
          className="inline-flex items-center justify-center h-10 px-5 rounded-md border border-line text-text"
        >
          Library
        </Link>
      </div>
      <section className="mt-16 grid gap-6 md:grid-cols-3">
        <div className="rounded-lg border border-line bg-surface-1 p-6">
          <div className="text-focus mb-2">01</div>
          <h2 className="font-medium mb-1">Analyze</h2>
          <p className="text-text-muted text-sm">Read the page to pull key content for overlays.</p>
        </div>
        <div className="rounded-lg border border-line bg-surface-1 p-6">
          <div className="text-focus mb-2">02</div>
          <h2 className="font-medium mb-1">Record</h2>
          <p className="text-text-muted text-sm">Capture your tab with smart event tracking.</p>
        </div>
        <div className="rounded-lg border border-line bg-surface-1 p-6">
          <div className="text-focus mb-2">03</div>
          <h2 className="font-medium mb-1">Edit and export</h2>
          <p className="text-text-muted text-sm">Auto-zoom, overlays, and export a polished video.</p>
        </div>
      </section>
      <footer className="mt-16 text-sm text-text-muted">
        Recordings never leave your device.
      </footer>
    </main>
  );
}
