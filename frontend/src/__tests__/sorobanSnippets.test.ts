import { SOROBAN_SNIPPETS } from "@/utils/sorobanSnippets";

describe("Soroban Monaco snippets", () => {
  it("provides macro scaffolds and editable template fields", () => {
    const snippetsByLabel = new Map(
      SOROBAN_SNIPPETS.map((snippet) => [snippet.label, snippet]),
    );

    expect(snippetsByLabel.get("contract")?.insertText).toContain("#[contract]");
    expect(snippetsByLabel.get("contractimpl")?.insertText).toContain("#[contractimpl]");
    expect(snippetsByLabel.get("contracterror")?.insertText).toContain("#[repr(u32)]");
    expect(snippetsByLabel.get("contracttype")?.insertText).toContain("pub struct");
    expect(snippetsByLabel.get("contractfn")?.insertText).toContain("${2:, caller: Address}");
    expect(snippetsByLabel.get("contracttype")?.insertText).toContain("${3:u32}");
    expect(snippetsByLabel.get("contractkeys")?.insertText).toContain("Address");
  });

  it("keeps completion labels unique", () => {
    const labels = SOROBAN_SNIPPETS.map((snippet) => snippet.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});