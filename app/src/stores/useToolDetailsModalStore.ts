import { create } from 'zustand'

interface ToolDetailsModalState {
  openToolId: string | null
  setOpenToolId: (id: string | null) => void
}

export const useToolDetailsModalStore = create<ToolDetailsModalState>((set) => ({
  openToolId: null,
  setOpenToolId: (id) => set({ openToolId: id }),
}))

/**
 * Hook for tool renderers: returns [isOpen, setIsOpen] for the given tool id.
 *
 * State is global and keyed by tool id, so the open modal survives renderer
 * unmount/remount caused by stream-driven block regrouping.
 *
 * From the end-user's prospective ensuring the tool doesn't get unmounted / remounted which can cause
 * the user to be discombobulated while interacting with the modal.
 * This is especially important for modals that have forms or other interactive elements as they will lose data otherwise.
 */
export function useToolDetailsModal(toolId?: string): [boolean, (open: boolean) => void] {
  const openToolId = useToolDetailsModalStore((s) => s.openToolId)
  const setOpenToolId = useToolDetailsModalStore((s) => s.setOpenToolId)
  const isOpen = !!toolId && openToolId === toolId
  const setIsOpen = (open: boolean): void => {
    setOpenToolId(open ? toolId ?? null : null)
  }
  return [isOpen, setIsOpen]
}
