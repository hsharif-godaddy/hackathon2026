/**
 * Pure, dependency-free semantic validation for a workflow step DAG.
 *
 * Deliberately free of DB/workspace/git so it can be imported both by the
 * workflow tool (`workflow.ts`) and by the shape-only `workflow-schemas.ts`
 * (which run-agent pulls in for the workflow-init `returnResult` schema) without
 * dragging native better-sqlite3 into that import graph.
 *
 * These checks are STATIC (structure only). Stateful acceptance — "already
 * initialized", a persistence write failure — is not knowable here and stays in
 * `workflow(init)`.
 */

/** Minimal structural shape shared by StepInput and WorkflowStep. */
export interface StepDagNode {
  id: string
  dependsOn: string[]
  ownedFiles: string[]
}

/**
 * Two steps conflict when they own a shared file yet neither depends on the
 * other — they could run concurrently and clobber each other's writes. Steps
 * ordered by a dependency edge are allowed to share files.
 */
export function validateOwnedFilesDisjoint(steps: StepDagNode[]): string[] {
  const errors: string[] = []
  for (let i = 0; i < steps.length; i++) {
    for (let j = i + 1; j < steps.length; j++) {
      const a: StepDagNode | undefined = steps[i]
      const b: StepDagNode | undefined = steps[j]
      if (a === undefined || b === undefined) continue
      // If one depends on the other, they can't run concurrently — skip
      if (a.dependsOn.includes(b.id) || b.dependsOn.includes(a.id)) continue
      // Check for overlapping files
      const overlap: string[] = a.ownedFiles.filter((f: string) => b.ownedFiles.includes(f))
      if (overlap.length > 0) {
        errors.push(`Steps "${a.id}" and "${b.id}" share ownedFiles: ${overlap.join(', ')}`)
      }
    }
  }
  return errors
}

function findDuplicateIds(steps: StepDagNode[]): string[] {
  const ids: string[] = steps.map((s: StepDagNode): string => s.id)
  const dupes: string[] = ids.filter((id: string, i: number): boolean => ids.indexOf(id) !== i)
  return [...new Set<string>(dupes)]
}

function findDanglingDependencies(steps: StepDagNode[]): string[] {
  const ids: Set<string> = new Set<string>(steps.map((s: StepDagNode): string => s.id))
  const errors: string[] = []
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) {
        errors.push(`Step "${step.id}" dependsOn unknown step "${dep}"`)
      }
    }
  }
  return errors
}

/**
 * Report a dependency cycle if one exists (at most one, for a concise message).
 * Iterative DFS with a recursion stack; edges point step → its dependency.
 */
function findDependencyCycle(steps: StepDagNode[]): string | null {
  const byId: Map<string, StepDagNode> = new Map<string, StepDagNode>(
    steps.map((s: StepDagNode): [string, StepDagNode] => [s.id, s]),
  )
  const visited: Set<string> = new Set<string>()
  const onStack: Set<string> = new Set<string>()

  const walk = (id: string, path: string[]): string[] | null => {
    visited.add(id)
    onStack.add(id)
    const node: StepDagNode | undefined = byId.get(id)
    for (const dep of node?.dependsOn ?? []) {
      // Dangling deps are reported separately; a missing target can't form a cycle.
      if (!byId.has(dep)) continue
      if (onStack.has(dep)) return [...path, id, dep]
      if (!visited.has(dep)) {
        const found: string[] | null = walk(dep, [...path, id])
        if (found !== null) return found
      }
    }
    onStack.delete(id)
    return null
  }

  for (const step of steps) {
    if (visited.has(step.id)) continue
    const cycle: string[] | null = walk(step.id, [])
    if (cycle !== null) {
      const start: number = cycle.indexOf(cycle[cycle.length - 1] as string)
      return cycle.slice(start).join(' -> ')
    }
  }
  return null
}

/**
 * Full static validation of a step DAG. Returns human-readable error strings
 * (empty = valid). A superset of the static checks `workflow(init)` performs, so
 * a DAG that passes this is guaranteed to clear init's static gates (leaving only
 * the stateful ones).
 */
export function validateStepDag(steps: StepDagNode[]): string[] {
  const errors: string[] = []

  const dupes: string[] = findDuplicateIds(steps)
  if (dupes.length > 0) errors.push(`Duplicate step ids: ${dupes.join(', ')}`)

  errors.push(...findDanglingDependencies(steps))

  const cycle: string | null = findDependencyCycle(steps)
  if (cycle !== null) errors.push(`Dependency cycle: ${cycle}`)

  errors.push(...validateOwnedFilesDisjoint(steps))

  return errors
}
