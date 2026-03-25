import { useTextEditing } from "./useTextEditing";
import { useHoverHint } from "./useHoverHint";
import { useImageHoverDetection } from "./useImageHoverDetection";

/**
 * Orchestrator hook for edit mode. Composes three focused hooks:
 *
 * - useTextEditing — inline click-to-edit with contentEditable
 * - useHoverHint — AI sparkle button, selection overlay, scroll tracking
 * - useImageHoverDetection — image hover state for ImageHoverBar
 */
export function useEditMode(isEditModeActive: boolean) {
  const { editingElement, saveStatus, stateRef, stopEditing } =
    useTextEditing(isEditModeActive);

  useHoverHint(isEditModeActive, stateRef);

  const { hoveredImage, handleBarMouseEnter, handleBarMouseLeave } =
    useImageHoverDetection(isEditModeActive, stateRef);

  return {
    isEditModeActive,
    editingElement,
    saveStatus,
    hoveredImage,
    handleBarMouseEnter,
    handleBarMouseLeave,
    stopEditing,
  };
}
