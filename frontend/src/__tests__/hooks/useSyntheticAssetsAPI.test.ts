import { useState } from "react";
import { renderHook, act } from "@testing-library/react";
import { useSyntheticAssetsAPI } from "@/hooks/useSyntheticAssetsAPI";

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockToken = "test-jwt-token";

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

import { useAuth } from "@/hooks/useAuth";

beforeEach(() => {
  jest.resetAllMocks();
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:3000";
});

describe("useSyntheticAssetsAPI", () => {
  beforeEach(() => {
    (useAuth as jest.Mock).mockReturnValue({ token: mockToken });
  });

  describe("loading state", () => {
    it("sets isLoading true during API call and false after", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: 1 } }),
      });

      const { result } = renderHook(() => useSyntheticAssetsAPI());

      expect(result.current.isLoading).toBe(false);

      let promise: Promise<any>;
      act(() => {
        promise = result.current.getPosition(1);
      });
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        await promise;
      });
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("error state", () => {
    it("sets error on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useSyntheticAssetsAPI());

      await act(async () => {
        await expect(result.current.getPosition(1)).rejects.toMatchObject({
          message: "Network error",
        });
      });

      expect(result.current.error).toEqual({ message: "Network error" });
    });

    it("sets error on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "Position not found" }),
      });

      const { result } = renderHook(() => useSyntheticAssetsAPI());

      await act(async () => {
        await expect(result.current.getPosition(99)).rejects.toMatchObject({
          message: "Position not found",
        });
      });

      expect(result.current.error).toEqual({ message: "Position not found" });
    });
  });

  describe("POST endpoints", () => {
    it("registerAsset sends correct payload", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "asset-123" }),
      });

      const { result } = renderHook(() => useSyntheticAssetsAPI());

      await act(async () => {
        await result.current.registerAsset({
          symbol: "USDC",
          name: "USD Coin",
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/synthetic-assets/register",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer test-jwt-token",
          }),
          body: JSON.stringify({ symbol: "USDC", name: "USD Coin" }),
        }),
      );
    });

    it("mintSynthetic sends correct payload", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ positionId: 42 }),
      });

      const { result } = renderHook(() => useSyntheticAssetsAPI());

      await act(async () => {
        await result.current.mintSynthetic({
          assetSymbol: "USDC",
          collateralAmount: 100,
          mintAmount: 50,
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/synthetic-assets/mint",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            userAddress: "current-user",
            assetSymbol: "USDC",
            collateralAmount: 100,
            mintAmount: 50,
          }),
        }),
      );
    });

    it("burnSynthetic sends correct payload", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ positionId: 42 }),
      });

      const { result } = renderHook(() => useSyntheticAssetsAPI());

      await act(async () => {
        await result.current.burnSynthetic({ positionId: 42, burnAmount: 25 });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/synthetic-assets/burn",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            userAddress: "current-user",
            positionId: 42,
            burnAmount: 25,
          }),
        }),
      );
    });
  });

  describe("GET endpoints", () => {
    it("getPosition hits correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ positionId: 1, asset: "USDC" }),
      });

      const { result } = renderHook(() => useSyntheticAssetsAPI());

      await act(async () => {
        await result.current.getPosition(1);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/synthetic-assets/position/1",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("getAssetPrice hits correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ symbol: "USDC", price: 1.0 }),
      });

      const { result } = renderHook(() => useSyntheticAssetsAPI());

      await act(async () => {
        await result.current.getAssetPrice("USDC");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/v1/synthetic-assets/price/USDC",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  describe("Authorization header", () => {
    it("includes Authorization header when token is present", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useSyntheticAssetsAPI());

      await act(async () => {
        await result.current.getPosition(1);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-jwt-token",
          }),
        }),
      );
    });

    it("omits Authorization header when token is absent", async () => {
      (useAuth as jest.Mock).mockReturnValue({ token: null });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useSyntheticAssetsAPI());

      await act(async () => {
        await result.current.getPosition(1);
      });

      const callOptions = mockFetch.mock.calls[0][1];
      expect(callOptions.headers).not.toHaveProperty("Authorization");
    });
  });
});
