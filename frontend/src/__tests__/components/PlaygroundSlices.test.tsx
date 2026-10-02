import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import EditorPane from "@/components/playground/EditorPane";
import OutputDrawer from "@/components/playground/OutputDrawer";
import {
  DEFAULT_CODE,
  INITIAL_LOGS,
  usePlaygroundStore,
} from "@/state/playgroundStore";

jest.mock("next/dynamic", () =>
  () =>
    function MockEditor({
      code,
      setCode,
    }: {
      code: string;
      setCode: (code: string) => void;
    }) {
      return (
        <textarea
          aria-label="source code"
          value={code}
          onChange={(event) => setCode(event.currentTarget.value)}
        />
      );
    },
);

jest.mock("@/components/ShareSnippet", () => ({
  __esModule: true,
  default: ({ code }: { code: string }) => (
    <span data-testid="shared-code">{code}</span>
  ),
}));

jest.mock("@/components/ConsoleAndEventsDrawer", () => ({
  ConsoleAndEventsDrawer: ({ logs }: { logs: string[] }) => (
    <div data-testid="drawer-logs">{logs.join("\n")}</div>
  ),
}));

describe("playground UI state slices", () => {
  beforeEach(() => {
    usePlaygroundStore.setState({
      code: DEFAULT_CODE,
      logs: INITIAL_LOGS,
      contractAbiOverride: null,
    });
  });

  it("updates the editor and share action from the source slice", () => {
    const onFormat = jest.fn();
    render(<EditorPane apiBaseUrl="https://api.example" onFormat={onFormat} />);

    const source = screen.getByRole("textbox", { name: "source code" });
    fireEvent.change(source, { target: { value: "contract source" } });

    expect(usePlaygroundStore.getState().code).toBe("contract source");
    expect(screen.getByTestId("shared-code")).toHaveTextContent(
      "contract source",
    );

    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    expect(onFormat).toHaveBeenCalledTimes(1);
  });

  it("selects current logs for the output drawer", () => {
    render(
      <OutputDrawer
        droppedMessages={0}
        isIngestionPaused={false}
        onIngestionPauseChange={jest.fn()}
      />,
    );

    act(() => {
      usePlaygroundStore.getState().appendLog("[compile] complete");
    });

    expect(screen.getByTestId("drawer-logs")).toHaveTextContent(
      "[compile] complete",
    );
  });

  it("keeps editor and output renders scoped to their selected slices", () => {
    const onEditorRender = jest.fn();
    const onOutputRender = jest.fn();

    render(
      <>
        <React.Profiler id="editor" onRender={onEditorRender}>
          <EditorPane apiBaseUrl="https://api.example" onFormat={jest.fn()} />
        </React.Profiler>
        <React.Profiler id="output" onRender={onOutputRender}>
          <OutputDrawer
            droppedMessages={0}
            isIngestionPaused={false}
            onIngestionPauseChange={jest.fn()}
          />
        </React.Profiler>
      </>,
    );

    act(() => {
      usePlaygroundStore.getState().appendLog("[compile] complete");
    });
    expect(onEditorRender).toHaveBeenCalledTimes(1);
    expect(onOutputRender).toHaveBeenCalledTimes(2);

    act(() => {
      usePlaygroundStore.getState().setCode("updated source");
    });
    expect(onEditorRender).toHaveBeenCalledTimes(2);
    expect(onOutputRender).toHaveBeenCalledTimes(2);
  });

  it("clears the deployment ABI override when source changes", () => {
    usePlaygroundStore.getState().resetContractAbi();
    expect(usePlaygroundStore.getState().contractAbiOverride).toEqual([]);

    usePlaygroundStore.getState().setCode("updated source");
    expect(usePlaygroundStore.getState().contractAbiOverride).toBeNull();
  });
});