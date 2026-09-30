import {
  decideThreeWayMerge,
  getSnapshotDepth,
  type EditorSnapshot,
} from "@/utils/editorHistory";

describe("editor history", () => {
  it("accepts changes made on only one side of a shared base", () => {
    expect(decideThreeWayMerge("base", "local", "base")).toEqual({
      kind: "local",
      code: "local",
    });
    expect(decideThreeWayMerge("base", "base", "remote")).toEqual({
      kind: "remote",
      code: "remote",
    });
    expect(decideThreeWayMerge("base", "same", "same")).toEqual({
      kind: "same",
      code: "same",
    });
  });

  it("surfaces divergent edits and computes snapshot branch depth", () => {
    expect(
      decideThreeWayMerge(
        "fn first() {}\nfn second() {}",
        "fn first() { 1 }\nfn second() {}",
        "fn first() {}\nfn second() { 2 }",
      ),
    ).toEqual({
      kind: "merged",
      code: "fn first() { 1 }\nfn second() { 2 }",
    });
    expect(decideThreeWayMerge("base", "local", "remote")).toEqual({
      kind: "conflict",
    });

    const root: EditorSnapshot = {
      id: "root",
      workspaceId: "workspace",
      parentId: null,
      code: "base",
      createdAt: 1,
      reason: "autosave",
    };
    const branch: EditorSnapshot = {
      ...root,
      id: "branch",
      parentId: root.id,
      createdAt: 2,
    };
    expect(
      getSnapshotDepth(branch, new Map([[root.id, root], [branch.id, branch]])),
    ).toBe(1);
  });
});