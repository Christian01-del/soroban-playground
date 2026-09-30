import { render, screen } from "@testing-library/react";
import PriceChart from "../PriceChart";

const sampleData = [
  { timestamp: 1700000000, price: 100 },
  { timestamp: 1700003600, price: 102 },
  { timestamp: 1700007200, price: 101 },
  { timestamp: 1700010800, price: 105 },
];

describe("PriceChart", () => {
  it("renders asset symbol in heading", () => {
    render(<PriceChart assetSymbol="XLM" />);
    expect(screen.getByText("XLM Price Chart")).toBeInTheDocument();
  });

  it("renders timeframe buttons", () => {
    render(<PriceChart assetSymbol="XLM" />);
    expect(screen.getByRole("tab", { name: "1H" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "1D" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "1W" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "1M" })).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<PriceChart assetSymbol="XLM" isLoading />);
    expect(screen.getByLabelText("Loading chart data")).toBeInTheDocument();
  });

  it("shows error state", () => {
    render(<PriceChart assetSymbol="XLM" error="Network error" />);
    expect(screen.getByText(/Failed to load chart data/)).toBeInTheDocument();
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  it("shows empty state when data has fewer than 2 points", () => {
    render(
      <PriceChart assetSymbol="XLM" data={[{ timestamp: 1, price: 100 }]} />,
    );
    expect(screen.getByText(/Insufficient data/)).toBeInTheDocument();
  });

  it("renders SVG chart when sufficient data provided", () => {
    const { container } = render(
      <PriceChart assetSymbol="XLM" data={sampleData} />,
    );
    const svg = container.querySelector(".price-chart-svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
  });

  it("renders positive change in green", () => {
    render(<PriceChart assetSymbol="XLM" priceChangePercent={5.2} />);
    const change = screen.getByText("+5.20%");
    expect(change).toHaveClass("positive");
  });

  it("renders negative change in red", () => {
    render(<PriceChart assetSymbol="XLM" priceChangePercent={-3.1} />);
    const change = screen.getByText("-3.10%");
    expect(change).toHaveClass("negative");
  });

  it("formats large volume values", () => {
    render(<PriceChart assetSymbol="XLM" volume24h={2_456_789} />);
    expect(screen.getByText("$2.46M")).toBeInTheDocument();
  });

  it("formats market cap values", () => {
    render(<PriceChart assetSymbol="XLM" marketCap={125_456_789} />);
    expect(screen.getByText("$125.46M")).toBeInTheDocument();
  });

  it("renders 0% change by default", () => {
    render(<PriceChart assetSymbol="XLM" />);
    expect(screen.getByText(/0\.00%/)).toBeInTheDocument();
  });

  it("has accessible region label", () => {
    render(<PriceChart assetSymbol="XLM" />);
    expect(
      screen.getByRole("region", { name: /XLM price chart/ }),
    ).toBeInTheDocument();
  });
});
