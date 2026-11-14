import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Vitest runs without injected globals, so React Testing Library's automatic
// cleanup (which sniffs for a global afterEach) never registers — do it here.
afterEach(cleanup);

// URL-restore tests (P0/P1 Task 5): the dashboard's sync effect writes
// ?q=/&bbox=/&tile= into location.search. beforeEach is the guarantee — an
// afterEach-only clear is not: afterEach hooks run LIFO (file hooks before
// setup hooks), so the URL clear ran BEFORE RTL's unmount, and a predecessor
// test's still-pending search promise could resolve in that window and
// re-write the URL for the NEXT test's mount to auto-restore (observed:
// fetch counts 3→4 in detail_panel, hidden guide in guidance).
beforeEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
});
afterEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
});

// Global next/navigation mock (P0/P1 Task 1 Step 0): Next 15's useRouter()
// throws "invariant expected app router to be mounted" without context, and
// eight suites render DashboardPage unmocked (AuthGuard lives in layout.tsx,
// which unit tests bypass). File-level mocks in authguard.test.tsx /
// login.test.tsx keep precedence over this setup-level default.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
