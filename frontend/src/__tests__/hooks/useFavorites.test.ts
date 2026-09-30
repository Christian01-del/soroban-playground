import { renderHook, act } from "@testing-library/react";
import {
  useFavorites,
  FavoriteTemplate,
  FavoritesState,
  Category,
} from "@/hooks/useFavorites";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

const mockTemplate: Omit<FavoriteTemplate, "addedAt"> = {
  id: "template-1",
  name: "Test Template",
  description: "A test template",
  categoryId: "defi",
  tags: ["test"],
};

describe("useFavorites", () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-01T00:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("load on mount", () => {
    it("loads favorites from localStorage on mount", () => {
      const preloaded: FavoritesState = {
        favorites: [
          {
            id: "template-1",
            name: "Test",
            description: "Desc",
            categoryId: null,
            tags: [],
            addedAt: "2023-01-01T00:00:00Z",
          },
        ],
        categories: [{ id: "custom", name: "Custom", color: "#fff" }],
      };
      localStorageMock.setItem(
        "soroban_template_favorites",
        JSON.stringify(preloaded),
      );

      const { result } = renderHook(() => useFavorites());

      expect(result.current.favorites).toHaveLength(1);
      expect(result.current.favorites[0].id).toBe("template-1");
      expect(result.current.categories).toHaveLength(1);
      expect(result.current.categories[0].id).toBe("custom");
    });

    it("uses defaults when localStorage is empty", () => {
      const { result } = renderHook(() => useFavorites());

      expect(result.current.favorites).toEqual([]);
      expect(result.current.categories).toEqual([
        { id: "defi", name: "DeFi", color: "#2dd4bf" },
        { id: "nft", name: "NFT", color: "#a78bfa" },
        { id: "governance", name: "Governance", color: "#f97316" },
      ]);
    });
  });

  describe("addFavorite", () => {
    it("adds favorite with timestamp and persists", () => {
      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.addFavorite(mockTemplate);
      });

      expect(result.current.favorites).toHaveLength(1);
      expect(result.current.favorites[0].id).toBe("template-1");
      expect(result.current.favorites[0].addedAt).toBe(
        "2024-01-01T00:00:00.000Z",
      );

      const stored = JSON.parse(
        localStorageMock.getItem("soroban_template_favorites")!,
      );
      expect(stored.favorites).toHaveLength(1);
      expect(stored.favorites[0].id).toBe("template-1");
    });
  });

  describe("removeFavorite", () => {
    it("removes favorite and persists", () => {
      localStorageMock.setItem(
        "soroban_template_favorites",
        JSON.stringify({
          favorites: [
            {
              id: "template-1",
              name: "Test",
              description: "Desc",
              categoryId: null,
              tags: [],
              addedAt: "2023-01-01T00:00:00Z",
            },
          ],
          categories: [],
        }),
      );

      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.removeFavorite("template-1");
      });

      expect(result.current.favorites).toHaveLength(0);

      const stored = JSON.parse(
        localStorageMock.getItem("soroban_template_favorites")!,
      );
      expect(stored.favorites).toHaveLength(0);
    });
  });

  describe("isFavorite", () => {
    it("returns true for favorited template", () => {
      localStorageMock.setItem(
        "soroban_template_favorites",
        JSON.stringify({
          favorites: [
            {
              id: "template-1",
              name: "Test",
              description: "Desc",
              categoryId: null,
              tags: [],
              addedAt: "2023-01-01T00:00:00Z",
            },
          ],
          categories: [],
        }),
      );

      const { result } = renderHook(() => useFavorites());

      expect(result.current.isFavorite("template-1")).toBe(true);
      expect(result.current.isFavorite("template-2")).toBe(false);
    });
  });

  describe("importFavorites", () => {
    it("merges without duplicates", () => {
      localStorageMock.setItem(
        "soroban_template_favorites",
        JSON.stringify({
          favorites: [
            {
              id: "template-1",
              name: "Test",
              description: "Desc",
              categoryId: null,
              tags: [],
              addedAt: "2023-01-01T00:00:00Z",
            },
          ],
          categories: [{ id: "defi", name: "DeFi", color: "#2dd4bf" }],
        }),
      );

      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.importFavorites(
          JSON.stringify({
            favorites: [
              {
                id: "template-1",
                name: "Updated",
                description: "Updated desc",
                categoryId: null,
                tags: ["new"],
                addedAt: "2023-01-01T00:00:00Z",
              },
              {
                id: "template-2",
                name: "New",
                description: "New desc",
                categoryId: null,
                tags: [],
                addedAt: "2024-01-01T00:00:00Z",
              },
            ],
            categories: [
              { id: "defi", name: "DeFi Updated", color: "#aaa" },
              { id: "nft", name: "NFT", color: "#a78bfa" },
            ],
          }),
        );
      });

      expect(result.current.favorites).toHaveLength(2);
      expect(result.current.favorites.map((f) => f.id)).toEqual([
        "template-1",
        "template-2",
      ]);
      expect(result.current.categories).toHaveLength(2);
    });
  });

  describe("exportFavorites", () => {
    it("creates blob and URL and triggers download", () => {
      const originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = jest.fn(() => "blob:fake-url");
      URL.revokeObjectURL = jest.fn();

      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.addFavorite(mockTemplate);
      });

      const clickSpy = jest.spyOn(document, "createElement");

      act(() => {
        result.current.exportFavorites();
      });

      expect(clickSpy).toHaveBeenCalledWith("a");
      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));

      URL.createObjectURL = originalRevokeObjectURL as any;
      URL.revokeObjectURL = originalRevokeObjectURL as any;
    });
  });
});
