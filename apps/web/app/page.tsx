import Link from "next/link";

/**
 * Public landing page (front door of the application). Auth-guarded product
 * surfaces (login, dashboard) arrive in Tasks 16+; the preview slots below
 * are filled with real screenshots/GIF in Task 24.
 */
export default function Home() {
  return (
    <main className="landing">
      <header className="landing__nav">
        <span className="landing__brand">Geo-RAG Earth Dashboard</span>
        <Link className="landing__nav-link" href="/login">
          Log in
        </Link>
      </header>

      <section className="hero">
        <p className="hero__eyebrow">Sentinel-2 · Red Sea coast</p>
        <h1>Geo-RAG Earth Dashboard</h1>
        <p className="hero__pitch">
          Search Sentinel-2 satellite imagery of the Red Sea coast in plain
          English: describe what you want to see — turquoise coastal water,
          desert near the shoreline, cloud patterns — and a retrieval-augmented
          vision model finds the matching scenes, ranks them by relevance, and
          opens each hit on an interactive map with thumbnails, capture dates,
          and buoy telemetry alongside.
        </p>
        <div className="hero__actions">
          <Link className="button button--primary" href="/login">
            Get started
          </Link>
          <Link className="button button--ghost" href="/login">
            Log in
          </Link>
        </div>
      </section>

      <section className="preview" aria-label="Product preview">
        <figure
          className="preview__slot"
          data-testid="screenshot-slot"
        >
          <span className="preview__label">Dashboard screenshot</span>
          <span className="preview__hint">Preview coming soon</span>
        </figure>
        <figure
          className="preview__slot preview__slot--wide"
          data-testid="gif-slot"
        >
          <span className="preview__label">Search-to-map walkthrough</span>
          <span className="preview__hint">Demo GIF coming soon</span>
        </figure>
      </section>

      <footer className="landing__footer">
        <p>Geo-RAG Earth Dashboard — retrieval-augmented search for Earth
          observation imagery.</p>
      </footer>
    </main>
  );
}
