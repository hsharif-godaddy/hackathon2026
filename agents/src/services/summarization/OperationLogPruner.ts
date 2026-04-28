import { logger } from '../../logging/index.js';
import type { OperationLogEntry } from './OperationLogExtractor.js';

/**
 * Prunes operation log entries to prevent unbounded growth
 *
 * Strategy: Keep most recent N operations (default: 500)
 * Prioritizes file operations (75%) over other operations (25%)
 * to preserve critical file modification history
 */
export class OperationLogPruner {
  private static readonly DEFAULT_MAX_OPERATIONS = 500;

  /**
   * Prune operation log entries to maximum count
   *
   * @param entries - Full operation log
   * @param maxOperations - Maximum operations to keep (default: 500)
   * @returns Pruned operation log
   */
  static prune(
    entries: OperationLogEntry[],
    maxOperations: number = this.DEFAULT_MAX_OPERATIONS
  ): OperationLogEntry[] {
    if (entries.length <= maxOperations) {
      return entries;
    }

    logger.info('operation_log.pruning.begin', {
      totalOperations: entries.length,
      maxOperations,
      excessOperations: entries.length - maxOperations,
    });

    // Strategy: Keep most recent operations, but prioritize file operations
    const fileOperations: OperationLogEntry[] = [];
    const otherOperations: OperationLogEntry[] = [];

    for (const entry of entries) {
      if (entry.tool === 'str_replace_based_edit_tool' || entry.tool === 'readFile') {
        fileOperations.push(entry);
      } else {
        otherOperations.push(entry);
      }
    }

    // Calculate allocation: 75% for file operations, 25% for others
    const fileOpsQuota = Math.floor(maxOperations * 0.75);
    const otherOpsQuota = maxOperations - fileOpsQuota;

    // Take what's available from each category up to the quota
    let prunedFileOps = fileOperations.slice(-Math.min(fileOperations.length, fileOpsQuota));
    let prunedOtherOps = otherOperations.slice(-Math.min(otherOperations.length, otherOpsQuota));

    // Redistribute unused quota to fill up to maxOperations
    const fileOpsDeficit = fileOpsQuota - prunedFileOps.length;
    const otherOpsDeficit = otherOpsQuota - prunedOtherOps.length;

    if (fileOpsDeficit > 0 && otherOperations.length > otherOpsQuota) {
      // More other ops available - take additional to fill file ops deficit
      const additionalOther = Math.min(fileOpsDeficit, otherOperations.length - otherOpsQuota);
      prunedOtherOps = otherOperations.slice(-(otherOpsQuota + additionalOther));
    }

    if (otherOpsDeficit > 0 && fileOperations.length > fileOpsQuota) {
      // More file ops available - take additional to fill other ops deficit
      const additionalFile = Math.min(otherOpsDeficit, fileOperations.length - fileOpsQuota);
      prunedFileOps = fileOperations.slice(-(fileOpsQuota + additionalFile));
    }

    const pruned = [...prunedFileOps, ...prunedOtherOps];

    logger.info('operation_log.pruning.complete', {
      originalCount: entries.length,
      prunedCount: pruned.length,
      fileOperations: prunedFileOps.length,
      otherOperations: prunedOtherOps.length,
      prunedFileOps: fileOperations.length - prunedFileOps.length,
      prunedOtherOps: otherOperations.length - prunedOtherOps.length,
    });

    return pruned;
  }

  /**
   * Check if operation log needs pruning
   *
   * @param entries - Operation log entries
   * @param maxOperations - Maximum operations threshold (default: 500)
   * @returns True if pruning is needed
   */
  static needsPruning(
    entries: OperationLogEntry[],
    maxOperations: number = this.DEFAULT_MAX_OPERATIONS
  ): boolean {
    return entries.length > maxOperations;
  }
}
