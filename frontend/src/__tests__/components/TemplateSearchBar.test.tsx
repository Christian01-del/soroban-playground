import { fireEvent, render, screen } from "@testing-library/react";
import TemplateSearchBar from "../../components/TemplateSearchBar";

describe("TemplateSearchBar", () => {
  it("renders input with correct placeholder and value", () => {
    render(
      <TemplateSearchBar
        value="hello"
        onChange={jest.fn()}
        placeholder="Custom placeholder"
      />,
    );

    const input = screen.getByLabelText("Search templates") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("hello");
    expect(input.placeholder).toBe("Custom placeholder");
  });

  it("calls onChange immediately on input change", () => {
    const onChange = jest.fn();
    render(<TemplateSearchBar value="" onChange={onChange} />);

    const input = screen.getByLabelText("Search templates");
    fireEvent.change(input, { target: { value: "test query" } });

    expect(onChange).toHaveBeenCalledWith("test query");
  });

  it("shows clear button when value is non-empty and calls onChange('') when clicked", () => {
    const onChange = jest.fn();
    render(<TemplateSearchBar value="non-empty" onChange={onChange} />);

    const clearBtn = screen.getByLabelText("Clear search");
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does not show clear button when value is empty", () => {
    render(<TemplateSearchBar value="" onChange={jest.fn()} />);

    expect(screen.queryByLabelText("Clear search")).not.toBeInTheDocument();
  });

  it("clears input when Escape key is pressed", () => {
    const onChange = jest.fn();
    render(<TemplateSearchBar value="some query" onChange={onChange} />);

    const input = screen.getByLabelText("Search templates");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onChange).toHaveBeenCalledWith("");
  });
});
