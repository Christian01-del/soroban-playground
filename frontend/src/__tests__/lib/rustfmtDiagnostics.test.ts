import { parseRustfmtDiagnostic } from "@/lib/rustfmtDiagnostics";

describe("parseRustfmtDiagnostic", () => {
  it("maps rustfmt parse locations to Monaco coordinates", () => {
    expect(
      parseRustfmtDiagnostic(
        "error: expected `;`\n --> input.rs:8:13",
      ),
    ).toEqual({
      startLineNumber: 8,
      startColumn: 13,
      message: "error: expected `;`\n --> input.rs:8:13",
    });
  });

  it("does not report formatter runtime failures as source errors", () => {
    expect(
      parseRustfmtDiagnostic("rustfmt crashed while formatting"),
    ).toBeUndefined();
  });
});