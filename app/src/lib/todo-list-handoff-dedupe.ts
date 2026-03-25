const claimedTodoListIds = new Set<string>()

export function claimTodoListHandoff(todoListId: string): boolean {
  if (claimedTodoListIds.has(todoListId)) {
    return false
  }
  claimedTodoListIds.add(todoListId)
  return true
}

export function releaseTodoListHandoff(todoListId: string): void {
  claimedTodoListIds.delete(todoListId)
}

export function resetTodoListHandoffLocksForTests(): void {
  claimedTodoListIds.clear()
}
