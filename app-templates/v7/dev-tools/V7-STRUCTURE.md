# V7 Dev-Tools Structure

This directory contains the v3 dev-tools with v7-specific adaptations.

## Files Structure

### Base Files (from v3)
- `src/` - Core dev-tools functionality copied from v3
  - Contains all the visual context capture and development mode features
  - Includes the utils/postMessage.ts security utilities
  - Full feature parity with v3

### V7-Specific Files
- `v7-config.ts` - Configuration for v7-specific differences
- `vite-plugin-v7.ts` - V7-specific vite plugin override (currently unused)
- `V7-STRUCTURE.md` - This documentation file

## Key Differences from V3

1. **Import Path**: v7 uses `../dev-tools/src/index` instead of `../../dev-tools/src/index`
   - This is due to v7's simpler frontend-only structure
   
2. **Entry Points**: v7 uses `main.tsx` instead of `entry-client.tsx`
   - Configured in `V7_CONFIG.entryPoints`

3. **Project Structure**: v7 is frontend-only, v3 is full-stack
   - v7: `src/main.tsx` (Vite + React)
   - v3: `src/frontend/entry-client.tsx` (SSR structure)

## How to Update from V3

When updating dev-tools from v3:

1. Copy the entire `src/` directory from v3
2. The v7-specific files will automatically adapt the configuration
3. The `v7-config.ts` ensures proper import paths and entry points

## Configuration

All v7-specific differences are centralized in `v7-config.ts`:
- Import paths
- Entry point detection
- Structure type
- Feature flags

This allows easy maintenance and updates while preserving v7 compatibility.