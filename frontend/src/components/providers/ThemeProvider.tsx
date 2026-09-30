"use client";

import React from "react";
import {
  createThemeController,
  type ThemeController,
  type ThemeState,
} from "@/lib/theme/engine";
import type { ThemePreference } from "@/lib/theme/types";

export interface ThemeContextValue {
  /** Current preference, resolved mode and provenance. */
  state: ThemeState;
  /** Change the preference (applies + persists immediately). */
  setPreference: (preference: ThemePreference) => void;
  /** Flip between light and dark, pinning an explicit preference. */
  toggle: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

/**
 * Owns the theme for the whole app.
 *
 * The controller is created lazily (once per browser session) and the rendered
 * tree is wrapped in context so any component can read or change the theme.
 * The pre-paint theme itself is set by {@link THEME_BOOTSTRAP_SCRIPT} in the
 * root layout — this provider keeps React state in step with it.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const controllerRef = React.useRef<ThemeController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createThemeController();
  }
  const controller = controllerRef.current;

  const [state, setState] = React.useState<ThemeState>(() => controller.getState());

  React.useEffect(() => {
    setState(controller.getState());
    return controller.subscribe(setState);
  }, [controller]);

  React.useEffect(() => () => controller.destroy(), [controller]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      state,
      setPreference: (preference) => setState(controller.setPreference(preference)),
      toggle: () => setState(controller.toggle()),
    }),
    [controller, state],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Read the active theme and the mutators. Must be used inside {@link ThemeProvider}. */
export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside a <ThemeProvider>");
  }
  return context;
}

export default ThemeProvider;
