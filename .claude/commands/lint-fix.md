Run lint with auto-fix for the package containing the file I'm currently working on. Use the appropriate command:

- TypeScript packages: `pnpm --filter <package> lint:fix`
- Go services: `make fmt-fix` in the service directory

Report what was fixed.
