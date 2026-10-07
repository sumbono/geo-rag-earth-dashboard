import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without injected globals, so React Testing Library's automatic
// cleanup (which sniffs for a global afterEach) never registers — do it here.
afterEach(cleanup);
