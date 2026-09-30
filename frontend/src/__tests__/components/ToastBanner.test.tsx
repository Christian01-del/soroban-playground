import React from "react";
import { render, screen } from "@testing-library/react";
import ToastBanner, { type Toast } from "@/components/ToastBanner";

describe("ToastBanner", () => {
  it("does not render when toast is null", () => {
    render(<ToastBanner toast={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders success toast with message", () => {
    const toast: Toast = { type: "success", message: "All good" };
    render(<ToastBanner toast={toast} />);
    expect(screen.getByRole("alert")).toHaveTextContent("All good");
    expect(screen.getByText(/All good/)).toBeInTheDocument();
  });

  it("renders error toast with message", () => {
    const toast: Toast = { type: "error", message: "Something went wrong" };
    render(<ToastBanner toast={toast} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });
});
