import {
  TEMPLATES,
  findTemplate,
  isRunnableTemplate,
} from "@/lib/templates";

describe("template catalog", () => {
  it("exposes a non-empty catalog", () => {
    expect(TEMPLATES.length).toBeGreaterThan(0);
  });

  it("gives every template a unique id", () => {
    const ids = TEMPLATES.map((template) => template.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses kebab-case ids so they are safe in a query string", () => {
    TEMPLATES.forEach((template) => {
      expect(template.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });
  });

  it("gives every template the metadata the gallery renders", () => {
    TEMPLATES.forEach((template) => {
      expect(template.name).not.toBe("");
      expect(template.description).not.toBe("");
      expect(template.category).not.toBe("");
      expect(template.tags.length).toBeGreaterThan(0);
      expect(["Beginner", "Intermediate", "Advanced"]).toContain(template.difficulty);
    });
  });
});

describe("findTemplate", () => {
  it("resolves a known id", () => {
    expect(findTemplate("hello-world")?.name).toBe("Hello World");
  });

  it("ignores surrounding whitespace", () => {
    expect(findTemplate("  hello-world  ")?.id).toBe("hello-world");
  });

  it("is case-insensitive", () => {
    expect(findTemplate("HELLO-WORLD")?.id).toBe("hello-world");
  });

  it("returns null for an unknown id", () => {
    expect(findTemplate("not-a-real-template")).toBeNull();
  });

  it("returns null for empty and whitespace ids", () => {
    expect(findTemplate("")).toBeNull();
    expect(findTemplate("   ")).toBeNull();
  });

  it("returns null for null and undefined", () => {
    expect(findTemplate(null)).toBeNull();
    expect(findTemplate(undefined)).toBeNull();
  });

  it("does not match on a partial id", () => {
    expect(findTemplate("hello")).toBeNull();
    expect(findTemplate("hello-world-extra")).toBeNull();
  });

  it("is not case-fooled by script payloads", () => {
    expect(findTemplate("<script>alert(1)</script>")).toBeNull();
    expect(findTemplate("__proto__")).toBeNull();
  });

  it("returns the catalog's own source, never caller input", () => {
    const template = findTemplate("hello-world");

    expect(template?.code).toContain("HelloContract");
    expect(template?.code).not.toContain("<script>");
  });
});

describe("isRunnableTemplate", () => {
  it("treats the hello-world template as runnable", () => {
    expect(isRunnableTemplate(findTemplate("hello-world")!)).toBe(true);
  });

  it("treats skeleton templates as not runnable", () => {
    const skeleton = TEMPLATES.filter(
      (template) => !isRunnableTemplate(template),
    );

    expect(skeleton.length).toBeGreaterThan(0);
    skeleton.forEach((template) => {
      expect(template.code).toMatch(/skeleton/);
    });
  });
});
