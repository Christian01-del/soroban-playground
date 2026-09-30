"use client";

import React, { useState, useMemo } from "react";

interface PriceDataPoint {
  timestamp: number;
  price: number;
}

interface PriceChartProps {
  assetSymbol: string;
  data?: PriceDataPoint[];
  priceChangePercent?: number;
  volume24h?: number;
  marketCap?: number;
  isLoading?: boolean;
  error?: string | null;
  onPriceUpdate?: () => void;
}

function formatPrice(
  points: PriceDataPoint[],
  width: number,
  height: number,
): string {
  if (points.length < 2) return "";
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  return points
    .map((p, i) => {
      const x = i * stepX;
      const y =
        height - ((p.price - min) / range) * (height * 0.8) - height * 0.1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const TIMEFRAMES = ["1H", "1D", "1W", "1M"] as const;

export default function PriceChart({
  assetSymbol,
  data = [],
  priceChangePercent = 0,
  volume24h = 0,
  marketCap = 0,
  isLoading = false,
  error = null,
}: PriceChartProps) {
  const [timeframe, setTimeframe] = useState<"1H" | "1D" | "1W" | "1M">("1D");
  const isPositive = priceChangePercent >= 0;

  const linePath = useMemo(() => formatPrice(data, 800, 400), [data]);

  const formatValue = (value: number): string => {
    if (value >= 1_000_000_000)
      return `$${(value / 1_000_000_000).toFixed(2)}B`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
  };

  return (
    <div
      className="price-chart"
      role="region"
      aria-label={`${assetSymbol} price chart`}
    >
      <div className="chart-header">
        <h4>{assetSymbol} Price Chart</h4>
        <div
          className="timeframe-buttons"
          role="tablist"
          aria-label="Chart timeframe"
        >
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              role="tab"
              aria-selected={timeframe === tf}
              className={`timeframe-btn ${timeframe === tf ? "active" : ""}`}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-container" aria-live="polite" aria-busy={isLoading}>
        {isLoading ? (
          <div className="chart-loading" role="status">
            <div className="spinner" aria-label="Loading chart data" />
          </div>
        ) : error ? (
          <div className="chart-error" role="alert">
            <p>Failed to load chart data: {error}</p>
          </div>
        ) : data.length < 2 ? (
          <div className="chart-empty" role="status">
            <p>Insufficient data to display chart for {assetSymbol}.</p>
          </div>
        ) : (
          <svg
            viewBox="0 0 800 400"
            className="price-chart-svg"
            role="img"
            aria-label={`${assetSymbol} price chart over ${timeframe}`}
          >
            <path
              d={linePath}
              fill="none"
              stroke={isPositive ? "#4CAF50" : "#ef4444"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      <div className="chart-stats">
        <div className="stat">
          <label>24h Change</label>
          <span className={isPositive ? "positive" : "negative"}>
            {isPositive ? "+" : ""}
            {priceChangePercent.toFixed(2)}%
          </span>
        </div>
        <div className="stat">
          <label>Volume (24h)</label>
          <span>{formatValue(volume24h)}</span>
        </div>
        <div className="stat">
          <label>Market Cap</label>
          <span>{formatValue(marketCap)}</span>
        </div>
      </div>
    </div>
  );
}
