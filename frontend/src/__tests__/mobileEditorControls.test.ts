import {
  calculatePinchFontSize,
  clampEditorFontSize,
} from "@/utils/mobileEditorControls";

describe("mobile editor controls", () => {
  it("scales from the original two-finger gesture distance", () => {
    expect(calculatePinchFontSize(14, 100, 150)).toBe(21);
    expect(calculatePinchFontSize(14, 100, 50)).toBe(10);
  });

  it("clamps zoom and handles invalid gesture measurements", () => {
    expect(calculatePinchFontSize(24, 100, 200)).toBe(28);
    expect(calculatePinchFontSize(16, 0, 120)).toBe(16);
    expect(clampEditorFontSize(Number.NaN)).toBe(14);
  });
});