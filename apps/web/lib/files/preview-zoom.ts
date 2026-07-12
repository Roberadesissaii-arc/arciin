export const PREVIEW_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const

export type PreviewZoomIndex = number

/** 75% — default fit is slightly below full pane width (100% felt too large). */
export const PREVIEW_ZOOM_DEFAULT_INDEX = 1

export function previewZoomAt(index: PreviewZoomIndex): number {
  return PREVIEW_ZOOM_STEPS[Math.max(0, Math.min(PREVIEW_ZOOM_STEPS.length - 1, index))] ?? 1
}

export function previewZoomPercent(index: PreviewZoomIndex): number {
  return Math.round(previewZoomAt(index) * 100)
}

export function canPreviewZoomIn(index: PreviewZoomIndex): boolean {
  return index < PREVIEW_ZOOM_STEPS.length - 1
}

export function canPreviewZoomOut(index: PreviewZoomIndex): boolean {
  return index > 0
}
