import { render, screen, fireEvent } from "@testing-library/react";
import TemplateLibraryGrid from "../../components/TemplateLibraryGrid";

const mockTemplates = [
  {
    id: "hello-world",
    name: "Hello World",
    description: "Minimal Soroban contract that returns a greeting string.",
  },
  {
    id: "counter",
    name: "Counter",
    description: "Simple counter contract.",
  },
];

describe("TemplateLibraryGrid", () => {
  it("renders empty state when templates are empty", () => {
    render(
      <TemplateLibraryGrid
        templates={[]}
        favorites={[]}
        onToggleFavorite={jest.fn()}
      />,
    );
    expect(screen.getByText("No templates found.")).toBeInTheDocument();
  });

  it("renders all templates passed in props", () => {
    render(
      <TemplateLibraryGrid
        templates={mockTemplates}
        favorites={[]}
        onToggleFavorite={jest.fn()}
      />,
    );
    expect(screen.getByText("Hello World")).toBeInTheDocument();
    expect(screen.getByText("Counter")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Minimal Soroban contract that returns a greeting string.",
      ),
    ).toBeInTheDocument();
  });

  it("renders correct favorite button state and calls onToggleFavorite when clicked", () => {
    const onToggleFavorite = jest.fn();
    render(
      <TemplateLibraryGrid
        templates={mockTemplates}
        favorites={["hello-world"]}
        onToggleFavorite={onToggleFavorite}
      />,
    );

    // hello-world is favorited
    const removeFavBtn = screen.getByLabelText(
      "Remove Hello World from favorites",
    );
    expect(removeFavBtn).toBeInTheDocument();

    // counter is not favorited
    const addFavBtn = screen.getByLabelText("Add Counter to favorites");
    expect(addFavBtn).toBeInTheDocument();

    // click to toggle favorite
    fireEvent.click(addFavBtn);
    expect(onToggleFavorite).toHaveBeenCalledWith("counter");
  });
});
