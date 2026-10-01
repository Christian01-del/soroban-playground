import {
  escapeHtml,
  escapeScriptJson,
  isSafeUrl,
  safeInlineImageUrl,
  sanitizeHtml,
  sanitizeText,
  SANITIZE_POLICY,
} from "@/lib/sanitize";

describe("escapeHtml", () => {
  it("escapes all five significant characters", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#x27;y&#x27;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("returns an empty string for nullish input", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("neutralizes a script tag supplied as a value", () => {
    expect(escapeHtml("<script>alert(1)</script>")).not.toContain("<script>");
  });
});

describe("escapeScriptJson", () => {
  it("escapes characters that could terminate an inline script block", () => {
    const result = escapeScriptJson({ name: "</script><img src=x onerror=alert(1)>" });

    expect(result).not.toContain("</script>");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
  });

  it("escapes line separators that would break a JS string literal", () => {
    expect(escapeScriptJson("a\u2028b\u2029c")).toBe('"a\\u2028b\\u2029c"');
  });

  it("falls back to null for values JSON cannot represent", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(escapeScriptJson(cyclic)).toBe("null");
  });

  it("produces parseable JSON for ordinary values", () => {
    expect(JSON.parse(escapeScriptJson({ a: 1 }))).toEqual({ a: 1 });
  });
});

describe("isSafeUrl", () => {
  it("accepts ordinary web schemes", () => {
    expect(isSafeUrl("https://stellar.org")).toBe(true);
    expect(isSafeUrl("http://localhost:3000/playground")).toBe(true);
    expect(isSafeUrl("mailto:dev@example.com")).toBe(true);
  });

  it("accepts relative and fragment URLs", () => {
    expect(isSafeUrl("/playground")).toBe(true);
    expect(isSafeUrl("#contract-storage")).toBe(true);
    expect(isSafeUrl("?tab=storage")).toBe(true);
  });

  it("rejects executable schemes", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects scheme obfuscation with whitespace, tabs and control characters", () => {
    expect(isSafeUrl("java\tscript:alert(1)")).toBe(false);
    expect(isSafeUrl("java\nscript:alert(1)")).toBe(false);
    expect(isSafeUrl("  javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("java\u0000script:alert(1)")).toBe(false);
  });

  it("rejects entity-encoded scheme obfuscation", () => {
    expect(isSafeUrl("java&#115;cript:alert(1)")).toBe(false);
    expect(isSafeUrl("java&#x73;cript:alert(1)")).toBe(false);
  });

  it("rejects document-bearing data URLs", () => {
    expect(isSafeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
  });

  it("allows raster data images only when explicitly opted in", () => {
    expect(isSafeUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
    expect(isSafeUrl("data:image/png;base64,iVBORw0KGgo=", { allowDataImages: true })).toBe(true);
  });

  it("rejects non-strings and empty values", () => {
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl(42)).toBe(false);
    expect(isSafeUrl("   ")).toBe(false);
  });
});

describe("sanitizeHtml - script execution", () => {
  it("removes script elements together with their content", () => {
    const result = sanitizeHtml("<p>before</p><script>alert(1)</script><p>after</p>");

    expect(result).toBe("<p>before</p><p>after</p>");
    expect(result).not.toContain("alert");
  });

  it("removes nested script payloads inside a dropped subtree", () => {
    expect(sanitizeHtml("<div><iframe src='evil'></iframe><script>alert(1)</script></div>")).toBe(
      "<div></div>",
    );
  });

  it("strips every on* event handler attribute", () => {
    const result = sanitizeHtml(`<img src="/a.png" onerror="alert(1)" onload='alert(2)' />`);

    expect(result).not.toContain("onerror");
    expect(result).not.toContain("onload");
    expect(result).toContain(`src="/a.png"`);
  });

  it("strips javascript: hrefs but keeps the anchor", () => {
    const result = sanitizeHtml(`<a href="javascript:alert(1)">click</a>`);

    expect(result).toBe("<a>click</a>");
  });

  it("removes style blocks and inline styles by default", () => {
    expect(sanitizeHtml("<style>body{background:url(javascript:1)}</style><p>x</p>")).toBe(
      "<p>x</p>",
    );
    expect(sanitizeHtml(`<p style="position:fixed;inset:0">x</p>`)).toBe("<p>x</p>");
  });

  it("keeps inline styles only when explicitly allowed", () => {
    expect(sanitizeHtml(`<p style="color:red">x</p>`, { allowStyles: true })).toContain("color:red");
  });

  it("removes object, embed, form and link elements", () => {
    expect(sanitizeHtml("<object data='x.swf'></object>")).toBe("");
    expect(sanitizeHtml("<embed src='x.swf'>")).toBe("");
    expect(sanitizeHtml("<form action='/x'><input name='a' /></form>")).toBe("");
    expect(sanitizeHtml("<link rel='stylesheet' href='https://evil/x.css'>")).toBe("");
  });

  it("removes svg and math, which carry their own script vectors", () => {
    expect(sanitizeHtml("<svg><script>alert(1)</script></svg>")).toBe("");
    expect(sanitizeHtml("<math><mtext></mtext></math>")).toBe("");
  });

  it("drops comments, CDATA and processing instructions", () => {
    expect(sanitizeHtml("<p>a</p><!-- <script>alert(1)</script> -->")).toBe("<p>a</p>");
    expect(sanitizeHtml("<p>a</p><![CDATA[<script>alert(1)</script>]]>")).toBe("<p>a</p>");
    expect(sanitizeHtml("<p>a</p><?php echo 1; ?>")).toBe("<p>a</p>");
  });
});

describe("sanitizeHtml - parser confusion", () => {
  it("does not execute a script smuggled through an unterminated tag", () => {
    const result = sanitizeHtml("<p>ok</p><img src=x onerror=alert(1)");

    // The dangling tag is emitted as inert escaped text, which is what a
    // browser's error recovery would do - and what a bypass relies on.
    expect(result).toContain("<p>ok</p>");
    expect(result).not.toContain("<img");
    expect(result).not.toMatch(/<[a-z]+\s[^>]*onerror/i);
  });

  it("treats an unclosed script element as inert content", () => {
    const result = sanitizeHtml("<p>ok</p><script>alert(1)");

    expect(result).not.toContain("alert(1)");
  });

  it("handles nested dangerous elements when stripping subtrees", () => {
    const result = sanitizeHtml("<form><form></form><input /></form><p>kept</p>");

    expect(result).toContain("kept");
    expect(result).not.toContain("<form");
  });

  it("emits balanced markup for unclosed allowed elements", () => {
    expect(sanitizeHtml("<div><p>text")).toBe("<div><p>text</p></div>");
  });

  it("ignores stray closing tags", () => {
    expect(sanitizeHtml("</div><p>text</p></span>")).toBe("<p>text</p>");
  });

  it("does not treat attribute-like text as markup", () => {
    expect(sanitizeHtml("<p>use &lt;button&gt; to submit</p>")).toBe(
      "<p>use &lt;button&gt; to submit</p>",
    );
  });

  it("is idempotent", () => {
    const once = sanitizeHtml(`<a href="https://stellar.org" target="_blank">Docs</a><img src="/a.png" />`);

    expect(sanitizeHtml(once)).toBe(once);
  });
});

describe("sanitizeHtml - allowed content", () => {
  it("preserves ordinary rich text", () => {
    const input = "<h2>Deploy</h2><p>Call <code>hello</code> then <strong>verify</strong>.</p>";

    expect(sanitizeHtml(input)).toBe(input);
  });

  it("preserves tables", () => {
    const input = "<table><thead><tr><th scope='col'>Key</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>";

    // Attribute quoting is normalized to double quotes on output.
    expect(sanitizeHtml(input)).toBe(
      `<table><thead><tr><th scope="col">Key</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>`,
    );
  });

  it("adds rel=noopener to target=_blank links", () => {
    const result = sanitizeHtml(`<a href="https://stellar.org" target="_blank">x</a>`);

    expect(result).toContain(`rel="noopener noreferrer"`);
  });

  it("forces external links to a safe rel even when one is supplied", () => {
    const result = sanitizeHtml(
      `<a href="https://stellar.org" target="_blank" rel="opener">x</a>`,
    );

    expect(result).toContain(`rel="noopener noreferrer"`);
    expect(result).not.toContain(`rel="opener"`);
  });

  it("keeps safe image sources and drops unsafe ones", () => {
    expect(sanitizeHtml(`<img src="/logo.png" alt="Logo" />`)).toContain(`src="/logo.png"`);
    expect(sanitizeHtml(`<img src="javascript:alert(1)" alt="x" />`)).not.toContain("javascript");
  });

  it("escapes text content so a value cannot inject a sibling element", () => {
    // The source text is already entity-encoded; it must survive as literal
    // text rather than being decoded back into a live element.
    const result = sanitizeHtml("<p>&lt;img src=x onerror=alert(1)&gt;</p>");

    expect(result).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
    expect(result).not.toContain("<img");
  });

  it("returns an empty string for non-string input", () => {
    expect(sanitizeHtml(null)).toBe("");
    expect(sanitizeHtml(undefined)).toBe("");
    expect(sanitizeHtml(123)).toBe("");
    expect(sanitizeHtml("")).toBe("");
  });

  it("truncates over-long input when maxLength is set", () => {
    // Truncation happens on the raw input, so a 50-char cap can still emit
    // slightly more once the retained markup is re-serialized.
    const result = sanitizeHtml(`<p>${"a".repeat(500)}</p>`, { maxLength: 50 });

    expect(result.length).toBeLessThan(80);
    expect(result).toMatch(/^<p>a+<\/p>$/);
  });

  it("keeps only the escaped inner text when dropDangerousContent is off", () => {
    const result = sanitizeHtml("<div>safe <script>alert(1)</script></div>", {
      dropDangerousContent: false,
    });

    expect(result).toBe("<div>safe alert(1)</div>");
    expect(result).not.toContain("<script");
  });
});

describe("sanitizeHtml - contract metadata", () => {
  it("sanitizes a contract name and docstring coming from a WASM artifact", () => {
    const metadata =
      '<p name="Counter"><script>steal()</script></p><p>doc &amp; notes</p>';

    const result = sanitizeHtml(metadata);

    expect(result).not.toContain("script");
    expect(result).toContain("doc &amp; notes");
  });

  it("sanitizes a hostile error string without losing the readable message", () => {
    const result = sanitizeHtml(`<img src=x onerror=alert(1)>Line 42: expected identifier`);

    expect(result).toContain("Line 42: expected identifier");
    expect(result).not.toMatch(/<img[^>]*onerror/i);
  });
});

describe("sanitizeText", () => {
  it("encodes markup characters in a non-HTML sink", () => {
    expect(sanitizeText("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("keeps plain contract identifiers intact", () => {
    expect(sanitizeText("CDLZVH3KAAAABJHPMHXK6R2GY7ZJHY5XJH5XJH5XJH5")).toBe(
      "CDLZVH3KAAAABJHPMHXK6R2GY7ZJHY5XJH5XJH5XJH5",
    );
  });

  it("coerces numbers and booleans and rejects other types", () => {
    expect(sanitizeText(42)).toBe("42");
    expect(sanitizeText(false)).toBe("false");
    expect(sanitizeText({})).toBe("");
    expect(sanitizeText(null)).toBe("");
  });
});

describe("safeInlineImageUrl", () => {
  it("accepts a raster base64 payload", () => {
    expect(safeInlineImageUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });

  it("rejects svg payloads that can carry script", () => {
    expect(safeInlineImageUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
  });

  it("rejects empty and non-string input", () => {
    expect(safeInlineImageUrl("")).toBeNull();
    expect(safeInlineImageUrl(null)).toBeNull();
  });
});

describe("SANITIZE_POLICY", () => {
  it("exposes the policy for documentation and assertions", () => {
    expect(SANITIZE_POLICY.dangerousTags.has("script")).toBe(true);
    expect(SANITIZE_POLICY.allowedTags.has("p")).toBe(true);
    expect(SANITIZE_POLICY.allowedUrlSchemes.has("https:")).toBe(true);
  });

  it("never allowlists a dangerous tag", () => {
    for (const tag of SANITIZE_POLICY.dangerousTags) {
      expect(SANITIZE_POLICY.allowedTags.has(tag)).toBe(false);
    }
  });
});
