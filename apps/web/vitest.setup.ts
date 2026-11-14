import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Vitest runs without injected globals, so React Testing Library's automatic
// cleanup (which sniffs for a global afterEach) never registers — do it here.
afterEach(cleanup);

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
