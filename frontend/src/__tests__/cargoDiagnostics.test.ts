import { parseCargoDiagnostics } from "@/utils/cargoDiagnostics";

describe("parseCargoDiagnostics", () => {
  it("parses Cargo JSON messages and suggested edits", () => {
    const output = JSON.stringify({
      reason: "compiler-message",
      message: {
        message: "expected `;`",
        level: "error",
        code: { code: "E0308" },
        spans: [
          {
            file_name: "src/lib.rs",
            line_start: 4,
            column_start: 12,
            line_end: 4,
            column_end: 12,
            is_primary: true,
          },
        ],
        children: [
          {
            message: "insert a semicolon",
            spans: [
              {
                file_name: "src/lib.rs",
                line_start: 4,
                column_start: 12,
                line_end: 4,
                column_end: 12,
                suggested_replacement: ";",
                suggestion_applicability: "MachineApplicable",
              },
            ],
          },
        ],
      },
    });

    expect(parseCargoDiagnostics([output])).toEqual([
      {
        message: "expected `;`",
        severity: "error",
        startLineNumber: 4,
        startColumn: 12,
        endLineNumber: 4,
        endColumn: 12,
        code: "E0308",
        fixes: [
          {
            title: "insert a semicolon",
            edits: [
              {
                startLineNumber: 4,
                startColumn: 12,
                endLineNumber: 4,
                endColumn: 12,
                text: ";",
              },
            ],
            isPreferred: true,
          },
        ],
      },
    ]);
  });

  it("ignores non-diagnostic output and diagnostics for other files", () => {
    const output = [
      "Compiling soroban-contract",
      JSON.stringify({
        reason: "compiler-message",
        message: {
          message: "unused variable",
          level: "warning",
          spans: [
            {
              file_name: "src/helper.rs",
              line_start: 1,
              column_start: 1,
              line_end: 1,
              column_end: 2,
              is_primary: true,
            },
          ],
        },
      }),
    ];

    expect(parseCargoDiagnostics(output)).toEqual([]);
  });
});