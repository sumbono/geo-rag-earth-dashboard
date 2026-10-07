import type { ReactNode } from "react";
import AuthGuard from "../../components/AuthGuard";

/**
 * Dashboard shell: every route under /dashboard renders behind AuthGuard,
 * which probes `GET /api/auth/me` on mount and bounces unauthenticated
 * visitors to /login. The page content itself arrives in Task 17.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
