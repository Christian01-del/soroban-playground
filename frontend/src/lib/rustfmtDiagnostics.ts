export interface RustFormatDiagnostic {
  startLineNumber: number;
  startColumn: number;
  message: string;
}

export function parseRustfmtDiagnostic(
  message: string,
): RustFormatDiagnostic | undefined {
  if (!/\b(error|parse)\b/i.test(message)) return undefined;

  const location = message.match(/input\.rs:(\d+):(\d+)/);
  return {
    startLineNumber: location ? Number(location[1]) : 1,
    startColumn: location ? Number(location[2]) : 1,
    message,
  };
}