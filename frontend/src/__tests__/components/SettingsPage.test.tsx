import { fireEvent, render, screen } from "@testing-library/react";
import SettingsPage from "../../components/SettingsPage";

describe("SettingsPage", () => {
  it("renders the preferences form with the expected default values", () => {
    render(<SettingsPage />);

    expect(
      screen.getByRole("heading", { name: /preferences/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/theme/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email notifications/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/auto-save drafts/i)).toBeInTheDocument();

    expect(screen.getByLabelText(/theme/i)).toHaveValue("dark");
    expect(screen.getByLabelText(/email notifications/i)).toBeChecked();
    expect(screen.getByLabelText(/auto-save drafts/i)).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("updates the theme and toggle settings and shows a save confirmation", () => {
    render(<SettingsPage />);

    fireEvent.change(screen.getByLabelText(/theme/i), {
      target: { value: "light" },
    });
    fireEvent.click(screen.getByLabelText(/auto-save drafts/i));
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));

    expect(screen.getByRole("status")).toHaveTextContent(
      /preferences saved successfully/i,
    );
    expect(screen.getByLabelText(/theme/i)).toHaveValue("light");
    expect(screen.getByLabelText(/auto-save drafts/i)).toBeChecked();
  });

  it("allows toggling preferences back off before saving", () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByLabelText(/auto-save drafts/i));
    fireEvent.click(screen.getByLabelText(/email notifications/i));
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));

    expect(screen.getByLabelText(/email notifications/i)).not.toBeChecked();
    expect(screen.getByLabelText(/auto-save drafts/i)).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      /preferences saved successfully/i,
    );
  });
});
