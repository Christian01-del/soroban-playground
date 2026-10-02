/**
 * Strict XSS defense for the Soroban Playground frontend (#1540).
 *
 * Every value that reaches the DOM as markup - contract metadata, compile
 * output, wallet names, template documentation, share links - passes through
 * this module first. The sanitizer is an *allowlist*: anything not explicitly
 * permitted is dropped, so a new injection vector fails closed rather than
 * open. There is deliberately no dependency on a third-party sanitizer here so
 * the security boundary cannot regress through a transitive upgrade; the
 * implementation is intentionally small, auditable and covered by
 * `src/__tests__/lib/sanitize.test.ts`.
 *
 * Guarantees:
 *  - `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`,
 *    `<meta>`, `<base>`, `<form>` and every `on*` handler are removed.
 *  - Attributes are allowlisted per tag; `javascript:`, `data:` (except safe
 *    image payloads), `vbscript:` and `file:` URLs are stripped.
 *  - `style` is dropped unless `allowStyles` is enabled, which is off by
 *    default because CSS can be used for exfiltration and UI redress.
 *  - Comments, CDATA sections and processing instructions are removed so the
 *    output cannot smuggle a parser differential against a browser.
 */

const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "var",
]);

/**
 * Elements whose *content* must go too. Stripping only the tag would leave
 * `alert(1)` sitting in the document as visible text, and for `style` /
 * `script` it would leave live code behind.
 */
const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "option",
  "optgroup",
  "textarea",
  "label",
  "fieldset",
  "link",
  "meta",
  "base",
  "title",
  "noscript",
  "template",
  "svg",
  "math",
]);

/** Tags that never have a closing tag, so the tag scanner must not expect one. */
const VOID_TAGS = new Set([
  "br",
  "col",
  "hr",
  "img",
  "wbr",
]);

const GLOBAL_ATTRIBUTES = new Set(["title", "lang", "dir"]);

const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "loading", "decoding"]),
  td: new Set(["colspan", "rowspan", "headers", "scope"]),
  th: new Set(["colspan", "rowspan", "headers", "scope", "abbr"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  ol: new Set(["start", "reversed", "type"]),
  details: new Set(["open"]),
};

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Schemes that carry executable or document-level semantics and are banned outright. */
const DANGEROUS_URL_SCHEMES = [
  "javascript:",
  "vbscript:",
  "data:text/html",
  "data:application/javascript",
  "data:text/javascript",
  "data:application/xhtml",
  "data:image/svg+xml",
];

/** `data:` image payloads that cannot execute script are allowed for `img src`. */
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$/i;

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  "#x27": "'",
  nbsp: "\u00a0",
};

/**
 * Encode the five XML/HTML significant characters. This is the only string
 * that is safe to interpolate into an attribute value delimited by `"`.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Escape a value for interpolation into an inline `<script>` block. A bare
 * `</script>` inside a string literal terminates the element in the HTML parser
 * even though it is inert to the JS parser, so the closing sequence has to be
 * broken up.
 */
export function escapeScriptJson(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value ?? null) ?? "null";
  } catch {
    json = "null";
  }

  return json
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Decode the small set of named/numeric entities the sanitizer emits. This
 * exists so the tokenizer can compare an attribute's *decoded* value against
 * the URL scheme allowlist, defeating `java&#115;cript:` style evasion.
 */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);?/gi, (match, entity: string) => {
    const key = entity.toLowerCase();

    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    return ENTITY_MAP[key] ?? match;
  });
}

/**
 * Strip characters an attacker uses to break up a scheme (`java\0script:`,
 * `java&#x09;script:`, ` javascript:`) and collapse them back to a comparable
 * form before the scheme check runs.
 */
function normalizeUrlForSchemeCheck(value: string): string {
  return decodeEntities(value)
    .replace(/[\u0000-\u0020\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]/g, "")
    .toLowerCase();
}

export function isSafeUrl(value: unknown, { allowDataImages = false } = {}): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = normalizeUrlForSchemeCheck(value).trim();

  if (normalized === "") {
    return false;
  }

  if (DANGEROUS_URL_SCHEMES.some((scheme) => normalized.startsWith(scheme))) {
    return false;
  }

  if (normalized.startsWith("data:")) {
    return allowDataImages && SAFE_DATA_IMAGE.test(normalized);
  }

  // Relative, protocol-relative and fragment URLs carry no scheme and cannot
  // introduce script execution.
  if (!/^[a-z][a-z0-9+.-]*:/.test(normalized)) {
    return true;
  }

  return ALLOWED_URL_SCHEMES.has(normalized.slice(0, normalized.indexOf(":") + 1));
}

function isAllowedAttribute(tag: string, name: string): boolean {
  if (name.startsWith("on")) {
    return false;
  }

  // Namespaced bindings (`xlink:href`, `xml:base`) and Angular/Vue style
  // shorthands are common sanitizer bypasses.
  if (name.includes(":") || name.includes("@") || name.startsWith("v-") || name.startsWith("[")) {
    return false;
  }

  const lower = name.toLowerCase();
  if (GLOBAL_ATTRIBUTES.has(lower) || lower === "style") {
    return true;
  }

  return TAG_ATTRIBUTES[tag]?.has(lower) ?? false;
}

interface ParsedAttribute {
  name: string;
  value: string;
}

const ATTRIBUTE_PATTERN =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;

function parseAttributes(raw: string): ParsedAttribute[] {
  const attributes: ParsedAttribute[] = [];
  ATTRIBUTE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(raw)) !== null) {
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attributes.push({ name: match[1], value });
  }

  return attributes;
}

function sanitizeUrlAttribute(value: string, tag: string, attribute: string): string | null {
  if (tag === "img" && attribute === "src") {
    return isSafeUrl(value, { allowDataImages: true }) ? value : null;
  }

  return isSafeUrl(value) ? value : null;
}

/**
 * Defense in depth for `style`: even when the caller opts in, a declaration
 * carrying a `url()` or an expression is dropped, because those are the two
 * CSS constructs that can leak data or execute script in older engines.
 */
function sanitizeStyleValue(value: string): string | null {
  const normalized = decodeEntities(value).replace(/[\u0000-\u001f]/g, "").toLowerCase();

  if (normalized.includes("expression(") || normalized.includes("javascript:") || normalized.includes("url(")) {
    return null;
  }

  return value;
}

/**
 * Anchor targets must never hand the opener to the destination page, otherwise
 * the opened document can drive `window.opener` and re-enter this origin.
 */
function normalizeLinkSafety(tag: string, attributes: ParsedAttribute[]): ParsedAttribute[] {
  if (tag !== "a") {
    return attributes;
  }

  const hasTargetBlank = attributes.some(
    (attribute) => attribute.name.toLowerCase() === "target" && attribute.value === "_blank",
  );

  if (!hasTargetBlank) {
    return attributes;
  }

  const next = attributes.filter((attribute) => attribute.name.toLowerCase() !== "rel");
  next.push({ name: "rel", value: "noopener noreferrer" });
  return next;
}

function renderOpenTag(tag: string, attributes: ParsedAttribute[]): string {
  if (attributes.length === 0) {
    return `<${tag}>`;
  }

  const rendered = attributes
    .map(({ name, value }) => `${name.toLowerCase()}="${escapeHtml(value)}"`)
    .join(" ");

  return `<${tag} ${rendered}>`;
}

export interface SanitizeOptions {
  /**
   * Keep `style` attributes. Off by default: inline CSS is a data-exfiltration
   * and clickjacking-adjacent vector and no current call site needs it.
   */
  allowStyles?: boolean;
  /**
   * Allow inline `<style>` blocks. Off by default for the same reason.
   */
  allowStyleBlocks?: boolean;
  /**
   * Drop the contents of dangerous elements instead of keeping their text.
   * Defaults to `true` so `<script>alert(1)</script>` yields nothing.
   */
  dropDangerousContent?: boolean;
  /** Maximum characters retained; excess is truncated. `0` disables truncation. */
  maxLength?: number;
}

const DEFAULT_OPTIONS: Required<SanitizeOptions> = {
  allowStyles: false,
  allowStyleBlocks: false,
  dropDangerousContent: true,
  maxLength: 0,
};

/**
 * Sanitize an untrusted HTML fragment.
 *
 * The implementation is a small hand-written tokenizer rather than a
 * `DOMParser` round-trip: the latter is unavailable during SSR, differs subtly
 * between jsdom and every real browser, and its output is a second serialization
 * step that has to be re-sanitized in turn.
 */
export function sanitizeHtml(dirty: unknown, options: SanitizeOptions = {}): string {
  const settings = { ...DEFAULT_OPTIONS, ...options };

  if (typeof dirty !== "string" || dirty === "") {
    return "";
  }

  let input = dirty;

  if (settings.maxLength > 0 && input.length > settings.maxLength) {
    input = input.slice(0, settings.maxLength);
  }

  // Remove entire subtrees that must never survive. A backreference-based
  // regex is insufficient for nested or unclosed elements, so the removal is
  // driven by the same scanner the main pass uses.
  const withoutDangerousSubtrees = settings.dropDangerousContent
    ? stripDangerousSubtrees(input, settings)
    : input;

  const withoutComments = stripNonElementNodes(withoutDangerousSubtrees);

  const out: string[] = [];
  const openTags: string[] = [];
  let cursor = 0;
  let index = 0;

  while (index < withoutComments.length) {
    const tagStart = withoutComments.indexOf("<", index);

    if (tagStart === -1) {
      out.push(escapeHtml(decodeEntities(withoutComments.slice(cursor))));
      break;
    }

    if (tagStart > cursor) {
      out.push(escapeHtml(decodeEntities(withoutComments.slice(cursor, tagStart))));
    }

    const tagEnd = withoutComments.indexOf(">", tagStart);

    if (tagEnd === -1) {
      // Unterminated tag: emit the remainder as inert text rather than
      // guessing where it ends, which is what a browser's error recovery
      // would do and what a bypass relies on.
      out.push(escapeHtml(decodeEntities(withoutComments.slice(tagStart))));
      break;
    }

    const rawTag = withoutComments.slice(tagStart + 1, tagEnd).trim();
    index = tagEnd + 1;
    // The tag has been consumed in full, so the next text run must start after
    // it. Advancing `cursor` here is what prevents the tag from also being
    // re-emitted as escaped text on the next iteration.
    cursor = index;

    if (rawTag === "" || rawTag.startsWith("!")) {
      // Empty or processing-instruction/comment remnant - drop.
      continue;
    }

    if (rawTag.startsWith("/")) {
      const name = rawTag.slice(1).trim().toLowerCase();
      const openIndex = openTags.lastIndexOf(name);

      if (openIndex === -1) {
        // Stray close tag for something never opened.
        continue;
      }

      // Implicitly close anything left open inside the popped element, then
      // pop it. The output is always balanced, so a sanitized fragment can
      // never break the layout of the tree it is injected into.
      while (openTags.length > openIndex) {
        const closing = openTags.pop();
        if (closing && !VOID_TAGS.has(closing)) {
          out.push(`</${closing}>`);
        }
      }
      continue;
    }

    const selfClosing = rawTag.endsWith("/");
    const body = selfClosing ? rawTag.slice(0, -1) : rawTag;
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(body);

    if (!nameMatch) {
      continue;
    }

    const tag = nameMatch[1].toLowerCase();
    const attributeSource = body.slice(nameMatch[1].length);

    if (DANGEROUS_TAGS.has(tag)) {
      if (VOID_TAGS.has(tag) || selfClosing) {
        // Already removed by the subtree pass when enabled; nothing to do.
        continue;
      }

      // Locate the matching close tag. Nesting is tracked so
      // `<form><form></form></form>` and an unclosed `<script>` both
      // terminate correctly.
      const remainder = withoutComments.slice(index);
      const scanned = scanDangerousElement(remainder, tag);
      index += scanned.total;
      cursor = index;

      if (settings.dropDangerousContent) {
        continue;
      }

      // Content-preserving mode: emit the inner text, escaped, and drop the
      // element's own tags. Escaped text can never execute, so this stays safe;
      // it is off by default because for `<script>` the "inner text" is code
      // that a reader has no reason to be shown.
      out.push(escapeHtml(decodeEntities(remainder.slice(0, scanned.innerLength))));
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown but harmless element: drop the tag, keep its text.
      continue;
    }

    if (tag === "style" && !settings.allowStyleBlocks) {
      continue;
    }

    const rawAttributes = parseAttributes(attributeSource);
    const kept: ParsedAttribute[] = [];

    for (const attribute of rawAttributes) {
      const attributeName = attribute.name.toLowerCase();

      if (!isAllowedAttribute(tag, attributeName)) {
        continue;
      }

      if (attributeName === "style") {
        if (!settings.allowStyles) {
          continue;
        }

        const safeStyle = sanitizeStyleValue(attribute.value);
        if (safeStyle === null) {
          continue;
        }

        kept.push({ name: "style", value: safeStyle });
        continue;
      }

      if (attributeName === "href" || attributeName === "src") {
        const safe = sanitizeUrlAttribute(attribute.value, tag, attributeName);
        if (safe === null) {
          continue;
        }
        kept.push({ name: attributeName, value: safe });
        continue;
      }

      kept.push({ name: attributeName, value: attribute.value });
    }

    const safeAttributes = normalizeLinkSafety(tag, kept);
    out.push(renderOpenTag(tag, safeAttributes));

    if (VOID_TAGS.has(tag)) {
      continue;
    }

    if (selfClosing) {
      out.push(`</${tag}>`);
      continue;
    }

    openTags.push(tag);
  }

  while (openTags.length > 0) {
    const closing = openTags.pop();
    if (closing && !VOID_TAGS.has(closing)) {
      out.push(`</${closing}>`);
    }
  }

  return out.join("");
}

/**
 * Locate the content of a dangerous element so the caller can either drop it
 * whole or keep only its escaped text.
 *
 * Returns the total prefix length to skip (open tag + content + close tag) and
 * the length of just the inner content. Nesting is counted, so
 * `<form><form></form></form>` resolves to the outer element and an unclosed
 * element consumes the rest of the string - both are the cases a naive
 * non-greedy regex gets wrong.
 */
function scanDangerousElement(source: string, tag: string): { total: number; innerLength: number } {
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  let depth = 0;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = pattern.exec(source)) !== null) {
    const end = match.index + match[0].length;

    if (match[1] === "/") {
      depth -= 1;

      if (depth <= 0) {
        // `match.index` is the start of the closing tag, so everything before
        // it is inner content.
        return { total: end, innerLength: match.index };
      }
    } else {
      depth += 1;
    }

    lastIndex = end;
  }

  return { total: source.length, innerLength: source.length - lastIndex };
}

function stripDangerousSubtrees(source: string, settings: SanitizeOptions): string {
  let result = source;

  for (const tag of DANGEROUS_TAGS) {
    if (tag === "style" && settings.allowStyleBlocks) {
      continue;
    }

    const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    result = result.replace(pattern, "");
  }

  return result;
}

/** Drop comments, CDATA blocks and processing instructions. */
function stripNonElementNodes(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
}

/**
 * Sanitize a value destined for a non-HTML sink, such as a `url(...)` inside
 * generated CSS or a redirect target. Untrusted text in these positions is
 * reduced to a harmless, printable form instead of being parsed as markup.
 */
export function sanitizeText(dirty: unknown): string {
  if (typeof dirty !== "string") {
    if (typeof dirty === "number" || typeof dirty === "boolean") {
      return String(dirty);
    }
    return "";
  }

  return stripNonElementNodes(dirty)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[<>"'`]/g, (character) => ENTITIES_FOR_TEXT[character] ?? character);
}

const ENTITIES_FOR_TEXT: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "`": "&#x60;",
};

/**
 * Build the `javascript:`-free `data:` URL for an inline SVG icon, or `null`
 * when the payload cannot be proven safe. Used by share/export features that
 * need an image source without going through a network request.
 */
export function safeInlineImageUrl(payload: string): string | null {
  if (typeof payload !== "string") {
    return null;
  }

  const trimmed = payload.trim();
  if (trimmed === "") {
    return null;
  }

  const base64Match = /^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,([a-z0-9+/=]+)$/i.exec(trimmed);
  if (!base64Match) {
    return null;
  }

  return trimmed;
}

export const SANITIZE_POLICY = {
  allowedTags: ALLOWED_TAGS,
  allowedUrlSchemes: ALLOWED_URL_SCHEMES,
  dangerousTags: DANGEROUS_TAGS,
} as const;
