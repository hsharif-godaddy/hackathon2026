package fixers

import "context"

// MySQLFixer starts the app-mysql Docker Compose service.
type MySQLFixer struct{}

func (f *MySQLFixer) Fix(ctx context.Context, projectRoot string) error {
	_, err := RunCommand(ctx, projectRoot, "docker", "compose", "up", "app-mysql", "-d")
	return err
}
