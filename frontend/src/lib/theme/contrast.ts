/**
 * WCAG 2.1 contrast utilities for the dynamic theme engine.
 *
 * Everything here is pure and synchronous so it can run in the browser (to gate
 * a custom theme), in Jest, and in CI. Colours are HSL channel triples in the
 * same `"h s% l%"` shape used by {@link import("./types").ThemeTokens}.
 */

import type { ContrastRequirement, ThemeTokens } from "./types";

/** WCAG 2.1 AA minimum for normal-size text. */
export const WCAG_AA_NORMAL = 4.5;
/** WCAG 2.1 AA minimum for large text (>= 18.66px bold or >= 24px). */
export const WCAG_AA_LARGE = 3;
/** WCAG 2.1 AAA minimum for normal-size text. */
export const WCAG_AAA_NORMAL = 7;
/** WCAG 2.1 AAA minimum for large text. */
export const WCAG_AAA_LARGE = 4.5;

export interface HslChannels {
  h: number;
  s: number;
  l: number;
}

/** An `[r, g, b]` triple with each channel in the 0–255 range. */
export type Rgb = [number, number, number];

export interface ContrastCheck {
  name: string;
  foreground: string;
  background: string;
  ratio: number;
  minimum: number;
  passes: boolean;
}

export interface ContrastReport {
  passes: boolean;
  checks: ContrastCheck[];
}

const HSL_TRIPLE = /^\s*(-?\d+(?:\.\d+)?)(?:deg)?\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%\s*$/;

/**
 * Parse a `"h s% l%"` token into numeric channels.
 *
 * Hue is normalised into `[0, 360)`; saturation and lightness must be
 * percentages because that is the only form CSS accepts for them.
 */
export function parseHslTriple(value: string): HslChannels {
  const match = HSL_TRIPLE.exec(value);
  if (!match) {
    throw new Error(
      `Invalid HSL triple "${value}" — expected the form "h s% l%", e.g. "217 59% 8%"`,
    );
  }

  const s = Number(match[2]);
  const l = Number(match[3]);
  if (s < 0 || s > 100) {
    throw new Error(`Invalid HSL triple "${value}" — saturation must be 0–100%`);
  }
  if (l < 0 || l > 100) {
    throw new Error(`Invalid HSL triple "${value}" — lightness must be 0–100%`);
  }

  return { h: ((Number(match[1]) % 360) + 360) % 360, s, l };
}

/** Serialise numeric channels back into a `"h s% l%"` token. */
export function formatHslTriple({ h, s, l }: HslChannels): string {
  return `${h} ${s}% ${l}%`;
}

/** Convert a `"h s% l%"` token (or parsed channels) to an sRGB triple. */
export function hslToRgb(value: string | HslChannels): Rgb {
  const { h, s, l } = typeof value === "string" ? parseHslTriple(value) : value;
  const saturation = s / 100;
  const lightness = l / 100;

  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hueSection = h / 60;
  const x = c * (1 - Math.abs((hueSection % 2) - 1));

  let r = 0;
  let g = 0;
  let b = 0;
  if (hueSection < 1) [r, g, b] = [c, x, 0];
  else if (hueSection < 2) [r, g, b] = [x, c, 0];
  else if (hueSection < 3) [r, g, b] = [0, c, x];
  else if (hueSection < 4) [r, g, b] = [0, x, c];
  else if (hueSection < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const m = lightness - c / 2;
  return [r + m, g + m, b + m].map((channel) =>
    Math.round(Math.min(1, Math.max(0, channel)) * 255),
  ) as Rgb;
}

/** Serialise a `"h s% l%"` token as a `#rrggbb` string (used by Monaco). */
export function hslToHex(value: string | HslChannels): string {
  return `#${hslToRgb(value)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** WCAG 2.1 relative luminance of an sRGB triple. */
export function relativeLuminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * WCAG 2.1 contrast ratio between two HSL tokens, in the range `1`–`21`.
 * The result is symmetric: `contrastRatio(a, b) === contrastRatio(b, a)`.
 */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(hslToRgb(foreground));
  const b = relativeLuminance(hslToRgb(background));
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Highest WCAG level a ratio satisfies, for human-readable reporting. */
export function wcagLevel(ratio: number): "fail" | "AA-large" | "AA" | "AAA" {
  if (ratio >= WCAG_AAA_NORMAL) return "AAA";
  if (ratio >= WCAG_AA_NORMAL) return "AA";
  if (ratio >= WCAG_AA_LARGE) return "AA-large";
  return "fail";
}

/**
 * Evaluate a single requirement against a token set.
 * Throws if a referenced token is missing or malformed.
 */
export function checkRequirement(
  tokens: ThemeTokens,
  requirement: ContrastRequirement,
): ContrastCheck {
  const foreground = tokens[requirement.foreground];
  const background = tokens[requirement.background];
  if (typeof foreground !== "string" || typeof background !== "string") {
    throw new Error(
      `Contrast requirement "${requirement.name}" references an unknown theme token`,
    );
  }

  const ratio = contrastRatio(foreground, background);
  return {
    name: requirement.name,
    foreground,
    background,
    ratio,
    minimum: requirement.minimum,
    passes: ratio >= requirement.minimum,
  };
}

/** Evaluate every requirement and aggregate the result. */
export function evaluateContrast(
  tokens: ThemeTokens,
  requirements: ContrastRequirement[],
): ContrastReport {
  const checks = requirements.map((requirement) =>
    checkRequirement(tokens, requirement),
  );
  return { passes: checks.every((check) => check.passes), checks };
}

/** A one-line, human-readable summary of a failing check. */
export function describeCheck(check: ContrastCheck): string {
  return `${check.passes ? "PASS" : "FAIL"} ${check.ratio.toFixed(2)}:1 (needs ${check.minimum}:1, ${wcagLevel(check.ratio)}) — ${check.name}`;
}
