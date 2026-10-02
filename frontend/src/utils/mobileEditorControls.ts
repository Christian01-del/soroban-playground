export const DEFAULT_EDITOR_FONT_SIZE = 14;
export const MIN_EDITOR_FONT_SIZE = 10;
export const MAX_EDITOR_FONT_SIZE = 28;

export function clampEditorFontSize(fontSize: number) {
  if (!Number.isFinite(fontSize)) return DEFAULT_EDITOR_FONT_SIZE;
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, fontSize));
}

export function calculatePinchFontSize(
  initialFontSize: number,
  initialDistance: number,
  currentDistance: number,
) {
  if (initialDistance <= 0 || currentDistance <= 0) {
    return clampEditorFontSize(initialFontSize);
  }

  return clampEditorFontSize(
    Math.round((initialFontSize * currentDistance) / initialDistance),
  );
}