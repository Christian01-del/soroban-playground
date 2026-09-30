/// <reference lib="webworker" />
interface RustMarker {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  severity: "error" | "warning" | "info";
  message: string;
}

const ctx = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent) => {
  const { code, uri } = event.data;
  const diagnostics = analyzeRustCode(code);
  ctx.postMessage({ uri, diagnostics });
};

function analyzeRustCode(code: string): RustMarker[] {
  const markers: RustMarker[] = [];
  const lines = code.split("\n");
  const stack: { char: string; line: number; col: number }[] = [];

  lines.forEach((line, lineIndex) => {
    for (let col = 0; col < line.length; col++) {
      const char = line[col];
      if (char === "{" || char === "(" || char === "[") {
        stack.push({ char, line: lineIndex + 1, col: col + 1 });
      } else if (char === "}" || char === ")" || char === "]") {
        const opener = stack.pop();
        if (!opener || !isMatchingPair(opener.char, char)) {
          markers.push({
            startLineNumber: lineIndex + 1,
            startColumn: col + 1,
            endLineNumber: lineIndex + 1,
            endColumn: col + 2,
            severity: "error",
            message: `Unmatched closing bracket '${char}'`,
          });
        }
      }
    }
  });

  for (const opener of stack) {
    markers.push({
      startLineNumber: opener.line,
      startColumn: opener.col,
      endLineNumber: opener.line,
      endColumn: opener.col + 1,
      severity: "error",
      message: `Unclosed opening bracket '${opener.char}'`,
    });
  }

  return markers;
}

function isMatchingPair(open: string, close: string): boolean {
  return (open === "{" && close === "}") ||
    (open === "(" && close === ")") ||
    (open === "[" && close === "]");
}