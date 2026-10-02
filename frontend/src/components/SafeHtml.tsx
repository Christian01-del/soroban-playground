"use client";

import React, { useMemo } from "react";
import { sanitizeHtml, type SanitizeOptions } from "@/lib/sanitize";

interface SafeHtmlProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "dangerouslySetInnerHTML"> {
  /** Untrusted markup. Sanitized before it ever reaches the DOM. */
  html: string;
  options?: SanitizeOptions;
  /** Element rendered as the container. Defaults to `div`. */
  as?: "div" | "span" | "section" | "article" | "p";
}

/**
 * The single sanctioned way to render untrusted markup in this app (#1540).
 *
 * `dangerouslySetInnerHTML` is banned outside the theme bootstrap script in
 * `app/layout.tsx`; every other sink goes through here, so there is exactly one
 * place where sanitization policy is applied and one place to audit.
 */
export default function SafeHtml({
  html,
  options,
  as: Tag = "div",
  className,
  ...rest
}: SafeHtmlProps) {
  const clean = useMemo(() => sanitizeHtml(html, options), [html, options]);

  return <Tag className={className} dangerouslySetInnerHTML={{ __html: clean }} {...rest} />;
}
