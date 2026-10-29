import Link from "next/link";

/**
 * Public landing page — Workbench macrostructure (design.md): bordered nav →
 * asymmetric hero (title left / demo-card proof right) → walkthrough GIF
 * workbench band → one dark graphite "How it works" band → single-line
 * text-only footer. The preview slot carries the walkthrough GIF
 * (docs/demo.gif, Task 24), mirrored into public/ so the page serves it
 * statically.
 */
export default function Home() {
  return (
    <div className="landing">
      {/* 1. bordered nav — GitHub link + ghost Log in; the hero owns the one solid accent */}
      <header className="landing__nav">
        <div className="landing__nav-inner">
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
            <Link className="landing__nav-login" href="/login">
              Log in
            </Link>
          </nav>
        </div>
      </header>

      <main className="landing__main">
        {/* 2. hero — two-column, title LEFT / proof RIGHT */}
        <section className="hero">
          <div className="hero__copy">
            <h1>Geo-RAG Earth Dashboard</h1>
            <p className="hero__pitch">
              Search Sentinel-2 satellite imagery of the Red Sea coast in plain
              English: describe what you want to see — turquoise coastal water,
              desert near the shoreline, cloud patterns — and a
              retrieval-augmented vision model finds the matching scenes, ranks
              them by relevance, and opens each hit on an interactive map with
              thumbnails, capture dates, and buoy telemetry alongside.
            </p>
            <div className="hero__actions">
              <Link className="button button--primary" href="/login">
                Get started
              </Link>
              <Link className="button button--ghost" href="/login">
                Log in
              </Link>
            </div>
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

        {/* 3. workbench band — the walkthrough GIF as hero proof */}
        <section className="preview" aria-label="Product preview">
          <figure className="preview__slot" data-testid="gif-slot">
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

        {/* 4. the one dark graphite band — 3 steps + what-you-get line */}
        <section className="how" aria-labelledby="how-title">
          <div className="how__inner">
            <h2 className="how__title" id="how-title">
              How it works
            </h2>
            <ol className="how__steps">
              <li className="how__step">
                <span className="how__step-label">Step 01</span>
                <h3 className="how__step-title">Describe in plain words</h3>
                <p className="how__step-body">
                  Write what you want to see — turquoise coastal water, desert
                  near the shoreline, cloud patterns.
                </p>
              </li>
              <li className="how__step">
                <span className="how__step-label">Step 02</span>
                <h3 className="how__step-title">Results rank by score</h3>
                <p className="how__step-body">
                  Every match carries a score from 0 to 1 and sorts best-first.
                </p>
              </li>
              <li className="how__step">
                <span className="how__step-label">Step 03</span>
                <h3 className="how__step-title">Open any result</h3>
                <p className="how__step-body">
                  Click a row for details, imagery, and its location on the map.
                </p>
              </li>
            </ol>
            <p className="how__note">
              Score is a semantic match between your words and the scene — 1.00
              near-exact, 0.00 unrelated. Date is the satellite capture date.
            </p>
          </div>
        </section>
      </main>

      {/* 5. single-line text-only footer — no links (accessibility-name discipline) */}
      <footer className="landing__footer">
        <p className="landing__footer-line">
          Geo-RAG Earth Dashboard · Retrieval-augmented search for Earth
          observation imagery · Sentinel-2 open data
        </p>
      </footer>
    </div>
  );
}
