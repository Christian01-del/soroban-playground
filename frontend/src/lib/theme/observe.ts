/**
 * Theme observation helpers.
 *
 * Non-React consumers (the Monaco editor, canvas charts, the WebGL call graph)
 * can subscribe to theme changes without threading a context through their
 * component tree.
 */

import { THEME_ATTRIBUTE, THEME_CHANGE_EVENT, getAppliedTheme } from "./engine";
import type { ThemeMode } from "./types";

/**
 * Call `listener` immediately with the current theme and again on every change
 * (both engine-driven and from the bootstrap script / another tab).
 *
 * Returns an unsubscribe function that is always safe to call.
 */
export function observeTheme(
  listener: (mode: ThemeMode) => void,
  target: Document | null = typeof document === "undefined" ? null : document,
): () => void {
  if (!target || !target.documentElement) return () => {};

  const emit = () => {
    const mode = getAppliedTheme(target);
    if (mode) listener(mode);
  };

  emit();

  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(emit);
    observer.observe(target.documentElement, {
      attributes: true,
      attributeFilter: [THEME_ATTRIBUTE],
    });
  }

  const onThemeEvent = () => emit();
  target.addEventListener(THEME_CHANGE_EVENT, onThemeEvent);

  return () => {
    observer?.disconnect();
    target.removeEventListener(THEME_CHANGE_EVENT, onThemeEvent);
  };
}
