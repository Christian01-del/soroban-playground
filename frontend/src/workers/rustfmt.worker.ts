import { format } from "@scalar/rust-fmt";
import type { RustFormatDiagnostic } from "@/lib/rustfmtDiagnostics";
import { parseRustfmtDiagnostic } from "@/lib/rustfmtDiagnostics";

interface FormatRequest {
  id: number;
  code: string;
}

interface FormatResponse {
  id: number;
  formatted?: string;
  diagnostics?: RustFormatDiagnostic[];
  error?: string;
}

const workerScope = self as unknown as {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<FormatRequest>) => void,
  ) => void;
  postMessage: (response: FormatResponse) => void;
};

workerScope.addEventListener("message", (event) => {
  void (async () => {
    try {
      const formatted = await format(event.data.code, { edition: "2021" });
      workerScope.postMessage({ id: event.data.id, formatted });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const diagnostic = parseRustfmtDiagnostic(message);
      if (diagnostic) {
        workerScope.postMessage({
          id: event.data.id,
          diagnostics: [diagnostic],
        });
      } else {
        workerScope.postMessage({ id: event.data.id, error: message });
      }
    }
  })();
});