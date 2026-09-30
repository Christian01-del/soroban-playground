import { renderHook, act } from "@testing-library/react";
import { useTemplateFilter } from "@/hooks/useTemplateFilter";
import { TemplateMetadata } from "@/types/template";

jest.mock("@/services/templateService", () => ({
  filterTemplates: jest.fn(),
}));

import { filterTemplates } from "@/services/templateService";

const mockFilterTemplates = filterTemplates as jest.MockedFunction<
  typeof filterTemplates
>;

const mockTemplates: TemplateMetadata[] = [
  {
    id: "hello-world",
    name: "Hello World",
    dirName: "hello-world",
    description: "Minimal Soroban contract example",
    category: "Utilities",
    functionalities: ["Basic"],
    complexity: "Beginner",
    deploymentStatus: "Testnet",
    dependencies: [],
    tags: ["minimal", "example"],
    features: ["Simple function call"],
  },
  {
    id: "stablecoin",
    name: "Stablecoin",
    dirName: "stablecoin",
    description: "Algorithmic stablecoin with collateral",
    category: "DeFi",
    functionalities: ["Token Operations", "Advanced"],
    complexity: "Advanced",
    deploymentStatus: "Production",
    dependencies: [{ name: "soroban-sdk", version: "^21.0" }],
    tags: ["defi", "collateral"],
    features: ["Minting", "Burning", "Price feed"],
  },
  {
    id: "counter",
    name: "Counter",
    dirName: "counter",
    description: "Simple counter with state management",
    category: "Utilities",
    functionalities: ["Basic", "State Management"],
    complexity: "Beginner",
    deploymentStatus: "Testnet",
    dependencies: [],
    tags: ["state", "storage"],
    features: ["State persistence"],
  },
];

beforeEach(() => {
  jest.resetAllMocks();
});

describe("useTemplateFilter", () => {
  it("filters templates reactively using initial criteria", () => {
    mockFilterTemplates.mockReturnValue(mockTemplates.slice(0, 1) as any);

    const { result } = renderHook(() => useTemplateFilter(mockTemplates));
    expect(result.current.filteredTemplates).toEqual(mockTemplates.slice(0, 1));
  });

  it("setSearch updates criteria and re-filters templates", async () => {
    mockFilterTemplates.mockReturnValue([mockTemplates[0]] as any);

    const { result } = renderHook(() => useTemplateFilter(mockTemplates));

    await act(async () => {
      result.current.setSearch("hello");
    });

    expect(result.current.filterState.criteria.searchQuery).toBe("hello");
    expect(mockFilterTemplates).toHaveBeenCalledWith(
      expect.any(Array),
      "hello",
      [],
      [],
      [],
      [],
      [],
    );
  });

  it("toggleCategory adds category when absent and removes when present", () => {
    const { result } = renderHook(() => useTemplateFilter(mockTemplates));

    act(() => {
      result.current.toggleCategory("DeFi");
    });
    expect(result.current.filterState.criteria.categories).toContain("DeFi");

    act(() => {
      result.current.toggleCategory("DeFi");
    });
    expect(result.current.filterState.criteria.categories).not.toContain(
      "DeFi",
    );
  });

  it("resetFilters restores initial criteria", () => {
    const { result } = renderHook(() => useTemplateFilter(mockTemplates));

    act(() => {
      result.current.setSearch("test");
      result.current.toggleCategory("DeFi");
    });

    expect(result.current.filterState.criteria.searchQuery).toBe("test");
    expect(result.current.filterState.criteria.categories).toContain("DeFi");

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.filterState.criteria.searchQuery).toBe("");
    expect(result.current.filterState.criteria.categories).toEqual([]);
  });

  it("filteredTemplates updates reactively when criteria change", async () => {
    mockFilterTemplates
      .mockReturnValueOnce([mockTemplates[0]] as any)
      .mockReturnValueOnce([mockTemplates[0], mockTemplates[1]] as any);

    const { result } = renderHook(() => useTemplateFilter(mockTemplates));

    expect(result.current.filteredTemplates).toEqual([mockTemplates[0]]);

    await act(async () => {
      result.current.setSearch("coin");
    });

    expect(result.current.filteredTemplates).toEqual([
      mockTemplates[0],
      mockTemplates[1],
    ]);
  });
});
