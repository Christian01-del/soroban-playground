import React from "react";
import { render, screen } from "@testing-library/react";
import SafeHtml from "@/components/SafeHtml";
import { sanitizeHtml } from "@/lib/sanitize";

describe("SafeHtml", () => {
  it("renders sanitized markup", () => {
    const { container } = render(<SafeHtml html="<p>Compiled <strong>successfully</strong></p>" />);

    expect(container.querySelector("strong")).toHaveTextContent("successfully");
  });

  it("renders as a div by default", () => {
    const { container } = render(<SafeHtml html="<p>x</p>" />);

    expect(container.firstElementChild?.tagName).toBe("DIV");
  });

  it("honours the as prop", () => {
    const { container } = render(<SafeHtml as="span" html="<p>x</p>" />);

    expect(container.firstElementChild?.tagName).toBe("SPAN");
  });

  it("passes through className and other DOM props", () => {
    const { container } = render(
      <SafeHtml className="prose" data-testid="doc" id="readme" html="<p>x</p>" />,
    );

    const element = container.firstElementChild!;
    expect(element).toHaveClass("prose");
    expect(element).toHaveAttribute("data-testid", "doc");
    expect(element).toHaveAttribute("id", "readme");
  });

  it("strips a script element from rendered output", () => {
    const { container } = render(<SafeHtml html="<p>ok</p><script>alert(1)</script>" />);

    expect(container.querySelector("script")).toBeNull();
    expect(container).toHaveTextContent("ok");
  });

  it("strips an inline event handler from rendered output", () => {
    const { container } = render(<SafeHtml html="<img src='/a.png' onerror='alert(1)' />" />);

    const image = container.querySelector("img")!;
    expect(image.getAttribute("onerror")).toBeNull();
    expect(image.getAttribute("src")).toBe("/a.png");
  });

  it("never injects a live script element for hostile input", () => {
    const payloads = [
      "<img src=x onerror=alert(1)>",
      "<svg/onload=alert(1)>",
      "<iframe src='javascript:alert(1)'></iframe>",
      "<body onload=alert(1)>",
      "<a href='javascript:alert(1)'>x</a>",
      "<style>@import 'evil.css';</style>",
      "<script>alert(1)</script>",
    ];

    payloads.forEach((payload) => {
      const { container, unmount } = render(<SafeHtml html={payload} />);

      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("iframe")).toBeNull();
      expect(container.querySelector("style")).toBeNull();
      expect(container.innerHTML).not.toMatch(/\son\w+\s*=/i);
      expect(container.innerHTML).not.toContain("javascript:");

      unmount();
    });
  });

  it("renders an empty container for non-string input", () => {
    const { container } = render(<SafeHtml html={undefined as unknown as string} />);

    expect(container.textContent).toBe("");
  });

  it("re-sanitizes on prop change rather than reusing stale markup", () => {
    const { container, rerender } = render(<SafeHtml html="<p>safe</p>" />);
    expect(container).toHaveTextContent("safe");

    rerender(<SafeHtml html="<p>unsafe</p><script>alert(1)</script>" />);

    expect(container).toHaveTextContent("unsafe");
    expect(container.querySelector("script")).toBeNull();
  });

  it("produces exactly what sanitizeHtml produces", () => {
    const html = `<h2>Counter</h2><p>Increment by <code>1</code></p><img src="/x.png" onerror="alert(1)">`;

    const { container } = render(<SafeHtml html={html} />);

    // The wrapper is the component's own element; the inner HTML is the
    // sanitized fragment and nothing else.
    expect(container.firstElementChild?.innerHTML).toBe(sanitizeHtml(html));
  });

  it("applies the allowStyles option", () => {
    const html = '<p style="color:red">x</p>';

    const { container: withoutStyle } = render(<SafeHtml html={html} />);
    expect(withoutStyle.firstElementChild?.innerHTML).toBe("<p>x</p>");

    const { container: withStyle } = render(
      <SafeHtml html={html} options={{ allowStyles: true }} />,
    );
    expect(withStyle.firstElementChild?.innerHTML).toContain("color:red");
  });

  it("adds a table with a caption-level description for screen readers", () => {
    render(
      <SafeHtml
        html="<table><tr><td>a</td></tr></table>"
        as="section"
        aria-label="Contract storage"
      />,
    );

    expect(screen.getByLabelText("Contract storage")).toBeInTheDocument();
  });
});
