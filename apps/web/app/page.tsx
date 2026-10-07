import Link from "next/link";

/**
 * Public landing page (front door of the application). The preview slot
 * below carries the walkthrough GIF (docs/demo.gif, Task 24), mirrored into
 * public/ so the page serves it statically.
 */
export default function Home() {
  return (
    <main className="landing">
      <header className="landing__nav">
        <span className="landing__brand">Geo-RAG Earth Dashboard</span>
        <nav className="landing__nav-links" aria-label="Header">
          <a
            className="landing__nav-link"
            href="https://github.com/sumbono/geo-rag-earth-dashboard"
            target="_blank"
            rel="noopener"
            aria-label="GitHub repository"
          >
            GitHub
          </a>
          <Link className="landing__nav-link" href="/login">
            Log in
          </Link>
        </nav>
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

        <aside className="demo-card" data-testid="demo-access-card">
          <p className="demo-card__tagline">
            Public sandbox with sample data
          </p>
          <p className="demo-card__creds">
            <span className="demo-card__field">
              <span className="demo-card__label">Username</span>
              <code className="demo-card__value">demo</code>
            </span>
            <span className="demo-card__field">
              <span className="demo-card__label">Password</span>
              <code className="demo-card__value">demo-pass-123</code>
            </span>
          </p>
        </aside>
      </section>

      <section className="preview" aria-label="Product preview">
        <figure
          className="preview__slot preview__slot--wide"
          data-testid="gif-slot"
        >
          <img
            className="preview__img"
            src="/demo.gif"
            alt="Walkthrough: log in, search for water, open a result in the detail panel, draw an area on the map, and read buoy telemetry"
            width={800}
            height={500}
            loading="lazy"
          />
          <figcaption className="preview__label">
            Search-to-map walkthrough
          </figcaption>
        </figure>
      </section>

      <footer className="landing__footer">
        <p>Geo-RAG Earth Dashboard — retrieval-augmented search for Earth
          observation imagery.</p>
      </footer>
    </main>
  );
}
