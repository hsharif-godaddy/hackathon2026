/**
 * Passthrough app ID adapter
 * 
 * Simply returns the original ID without any transformation
 * Used for environments where job ID → app ID transition doesn't happen
 */
import { IAppIdAdapter } from './IAppIdAdapter'

export class PassthroughAppIdAdapter implements IAppIdAdapter {
  /**
   * Returns the original ID without any transformation
   * 
   * @param id - The original ID
   * @param _operation - The operation being performed (unused in this adapter)
   * @returns The original ID
   */
  async resolveAppId(id: string, _operation: string): Promise<string> {
    return id
  }
}
