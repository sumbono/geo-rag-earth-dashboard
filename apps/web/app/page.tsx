import Link from "next/link";

/**
 * Public landing page (front door of the application). The preview slots
 * below carry the real assets from docs/screenshots + docs/demo.gif
 * (Task 24), mirrored into public/ so the page serves them statically.
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
          <img
            className="preview__img"
            src="/screenshots/dashboard-with-results.png"
            alt="Dashboard after a search: ranked tile results with scores and capture dates beside the satellite basemap of the Red Sea coast"
            width={1440}
            height={900}
            loading="lazy"
          />
          <figcaption className="preview__label">
            Dashboard screenshot
          </figcaption>
        </figure>
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
