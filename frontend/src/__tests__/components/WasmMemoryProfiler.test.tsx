import React from "react";
import { render, screen } from "@testing-library/react";
import WasmMemoryProfiler from "@/components/WasmMemoryProfiler";
import type { WasmMemoryProfile } from "@/utils/wasmInspector";

describe("WasmMemoryProfiler", () => {
  const mockProfile: WasmMemoryProfile = {
    totalBytes: 128000,
    sections: [
      {
        id: 10,
        name: "Code (Compiled Bytecode)",
        sizeBytes: 80000,
        percentage: 62.5,
      },
      {
        id: 11,
        name: "Data (Static Memory Buffers)",
        sizeBytes: 20000,
        percentage: 15.6,
      },
    ],
    staticDataBytes: 20000,
    heapMinBytes: 65536,
    heapMaxBytes: 131072,
    stackEstimateBytes: 65536,
    heavyFunctions: [
      { name: "hello", estimatedSize: 40000, lineHint: 12 },
      { name: "transfer", estimatedSize: 20000, lineHint: 24 },
    ],
  };

  it("renders null state message when no profile is passed", () => {
    render(<WasmMemoryProfiler profile={null} />);
    expect(
      screen.getByText(/No WASM memory profile available/i),
    ).toBeInTheDocument();
  });

  it("renders metric cards and section distribution", () => {
    render(<WasmMemoryProfiler profile={mockProfile} />);
    expect(screen.getByText(/WASM Memory Profiler/i)).toBeInTheDocument();
    expect(screen.getByText(/125.00 KB/i)).toBeInTheDocument(); // total bytes format
    expect(screen.getByText(/Code \(Compiled Bytecode\)/i)).toBeInTheDocument();
  });
});
