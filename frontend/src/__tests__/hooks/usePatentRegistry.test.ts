import { renderHook, act } from "@testing-library/react";
import {
  usePatentRegistry,
  Stats,
  Patent,
  License,
  Dispute,
} from "@/hooks/usePatentRegistry";

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:3001";
  process.env.NEXT_PUBLIC_API_BASE_URL = "";
});

describe("usePatentRegistry", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("run wrapper", () => {
    it("sets loading true during execution and false after", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { patentCount: 5 } }),
      });

      const { result } = renderHook(() => usePatentRegistry());

      let promise: Promise<any>;
      act(() => {
        promise = result.current.getStats();
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        await promise;
      });
      expect(result.current.loading).toBe(false);
    });

    it("sets error and returns null on failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => usePatentRegistry());

      let ret: any;
      await act(async () => {
        ret = await result.current.getStats();
      });

      expect(ret).toBeNull();
      expect(result.current.error).toBe("Network error");
      expect(result.current.loading).toBe(false);
    });
  });

  describe("GET endpoints", () => {
    it("getStats returns stats data", async () => {
      const stats: Stats = {
        patentCount: 10,
        licenseCount: 20,
        disputeCount: 5,
        paused: false,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: stats }),
      });

      const { result } = renderHook(() => usePatentRegistry());

      let ret: any;
      await act(async () => {
        ret = await result.current.getStats();
      });

      expect(ret).toEqual(stats);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/patents/stats"),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it("getPatent returns patent data", async () => {
      const patent: Patent = {
        title: "Test Patent",
        description: "A test patent",
        owner: "0xowner",
        filing_date: 1234567890,
        expiry_date: 9999999999,
        status: "Active",
        license_count: 1,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: patent }),
      });

      const { result } = renderHook(() => usePatentRegistry());

      let ret: any;
      await act(async () => {
        ret = await result.current.getPatent(1);
      });

      expect(ret).toEqual(patent);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/patents/1"),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it("getLicense returns license data", async () => {
      const license: License = {
        patent_id: 1,
        licensee: "0xlicensee",
        license_type: "Exclusive",
        fee: 1000,
        expiry_date: 9999999999,
        granted_date: 1234567890,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: license }),
      });

      const { result } = renderHook(() => usePatentRegistry());

      let ret: any;
      await act(async () => {
        ret = await result.current.getLicense(1);
      });

      expect(ret).toEqual(license);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/patents/licenses/1"),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it("getDispute returns dispute data", async () => {
      const dispute: Dispute = {
        patent_id: 1,
        claimant: "0xclaimant",
        reason: "Invalid patent",
        filed_date: 1234567890,
        status: "Open",
        resolution: "",
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: dispute }),
      });

      const { result } = renderHook(() => usePatentRegistry());

      let ret: any;
      await act(async () => {
        ret = await result.current.getDispute(1);
      });

      expect(ret).toEqual(dispute);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/patents/disputes/1"),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });
  });

  describe("POST endpoints", () => {
    it("filePatent sends correct POST body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: 42 }),
      });

      const { result } = renderHook(() => usePatentRegistry());

      let ret: any;
      await act(async () => {
        ret = await result.current.filePatent({
          inventor: "0xinventor",
          title: "New Patent",
          description: "A new invention",
          expiryDate: 9999999999,
        });
      });

      expect(ret).toBe(42);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/patents/file"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            inventor: "0xinventor",
            title: "New Patent",
            description: "A new invention",
            expiryDate: 9999999999,
          }),
        }),
      );
    });

    it("activatePatent sends correct POST body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: true }),
      });

      const { result } = renderHook(() => usePatentRegistry());

      await act(async () => {
        await result.current.activatePatent(1, "0xadmin");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/patents/1/activate"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ admin: "0xadmin" }),
        }),
      );
    });

    it("revokePatent sends correct POST body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: true }),
      });

      const { result } = renderHook(() => usePatentRegistry());

      await act(async () => {
        await result.current.revokePatent(1, "0xadmin");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/patents/1/revoke"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ admin: "0xadmin" }),
        }),
      );
    });
  });

  describe("error handling", () => {
    it("handles non-ok response in GET endpoints", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: "Not found" }),
      });

      const { result } = renderHook(() => usePatentRegistry());

      let ret: any;
      await act(async () => {
        ret = await result.current.getPatent(999);
      });

      expect(ret).toBeNull();
      expect(result.current.error).toBe("Not found");
    });

    it("handles non-ok response in POST endpoints", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: "Forbidden" }),
      });

      const { result } = renderHook(() => usePatentRegistry());

      let ret: any;
      await act(async () => {
        ret = await result.current.activatePatent(1, "0xadmin");
      });

      expect(ret).toBeNull();
      expect(result.current.error).toBe("Forbidden");
    });
  });
});
