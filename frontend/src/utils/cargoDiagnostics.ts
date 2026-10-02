export interface DiagnosticEdit {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  text: string;
}

export interface DiagnosticFix {
  title: string;
  edits: DiagnosticEdit[];
  isPreferred: boolean;
}

export interface CargoDiagnostic {
  message: string;
  severity: "error" | "warning" | "info";
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  code?: string;
  fixes: DiagnosticFix[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getCargoMessages(input: unknown): unknown[] {
  const values = Array.isArray(input) ? input : [input];

  return values.flatMap((value) => {
    if (typeof value !== "string") return [value];
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return undefined;
        }
      });
  });
}

function getSuggestedEdits(spans: unknown): DiagnosticEdit[] {
  if (!Array.isArray(spans)) return [];

  return spans.flatMap((value) => {
    if (!isRecord(value) || typeof value.suggested_replacement !== "string") {
      return [];
    }
    if (
      typeof value.line_start !== "number" ||
      typeof value.column_start !== "number" ||
      typeof value.line_end !== "number" ||
      typeof value.column_end !== "number"
    ) {
      return [];
    }

    return [
      {
        startLineNumber: value.line_start,
        startColumn: value.column_start,
        endLineNumber: value.line_end,
        endColumn: value.column_end,
        text: value.suggested_replacement,
      },
    ];
  });
}

function getFixes(diagnostic: JsonRecord): DiagnosticFix[] {
  const fixes: DiagnosticFix[] = [];
  const primaryEdits = getSuggestedEdits(diagnostic.spans);
  const primarySpans = Array.isArray(diagnostic.spans) ? diagnostic.spans : [];
  const preferred = primarySpans.some(
    (span) =>
      isRecord(span) && span.suggestion_applicability === "MachineApplicable",
  );

  if (primaryEdits.length) {
    fixes.push({
      title: "Apply suggested change",
      edits: primaryEdits,
      isPreferred: preferred,
    });
  }

  if (Array.isArray(diagnostic.children)) {
    for (const child of diagnostic.children) {
      if (!isRecord(child)) continue;
      const edits = getSuggestedEdits(child.spans);
      if (!edits.length) continue;

      const spans = Array.isArray(child.spans) ? child.spans : [];
      fixes.push({
        title:
          typeof child.message === "string" && child.message
            ? child.message
            : "Apply suggested change",
        edits,
        isPreferred: spans.some(
          (span) =>
            isRecord(span) &&
            span.suggestion_applicability === "MachineApplicable",
        ),
      });
    }
  }

  return fixes;
}

export function parseCargoDiagnostics(input: unknown): CargoDiagnostic[] {
  return getCargoMessages(input).flatMap((value) => {
    if (!isRecord(value)) return [];
    const candidate =
      value.reason === "compiler-message" && isRecord(value.message)
        ? value.message
        : value;
    if (
      typeof candidate.message !== "string" ||
      !Array.isArray(candidate.spans)
    ) {
      return [];
    }

    const span =
      candidate.spans.find(
        (entry) => isRecord(entry) && entry.is_primary === true,
      ) ?? candidate.spans[0];
    if (
      !isRecord(span) ||
      typeof span.line_start !== "number" ||
      typeof span.column_start !== "number" ||
      typeof span.line_end !== "number" ||
      typeof span.column_end !== "number"
    ) {
      return [];
    }
    if (
      typeof span.file_name === "string" &&
      !/(^|[\\/])lib\.rs$/.test(span.file_name)
    ) {
      return [];
    }

    const level = candidate.level;
    return [
      {
        message: candidate.message,
        severity:
          level === "error"
            ? "error"
            : level === "warning"
              ? "warning"
              : "info",
        startLineNumber: span.line_start,
        startColumn: span.column_start,
        endLineNumber: span.line_end,
        endColumn: span.column_end,
        ...(isRecord(candidate.code) && typeof candidate.code.code === "string"
          ? { code: candidate.code.code }
          : {}),
        fixes: getFixes(candidate),
      },
    ];
  });
}