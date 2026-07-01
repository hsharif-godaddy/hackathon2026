package templatesync

import (
	"context"
	"fmt"
	"hash/fnv"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	defaultAppsBaseDir      = "/tmp/airo-app-builder"
	defaultProjectRoot      = ".."
	defaultPoll             = time.Second
	gitUpdateIndexBatchSize = 100
)

var (
	defaultFolders  = []string{"dev-tools", "source-mapper"}
	defaultExcludes = []string{"node_modules", "dist", ".turbo", ".vite"}
)

type commandRunner func(context.Context, string, ...string) error

type config struct {
	appsBaseDir string
	templateDir string
	folders     []string
	excludes    []string
	poll        time.Duration
	run         commandRunner
}

type syncer struct {
	cfg    config
	logger *slog.Logger
	last   map[string]sourceTreeStamp
}

type sourceTreeStamp struct {
	exists      bool
	fingerprint uint64
}

func (s sourceTreeStamp) IsZero() bool {
	return !s.exists
}

func (s sourceTreeStamp) Equal(other sourceTreeStamp) bool {
	return s.exists == other.exists && s.fingerprint == other.fingerprint
}

func (s sourceTreeStamp) String() string {
	if !s.exists {
		return "<missing>"
	}
	return fmt.Sprintf("%x", s.fingerprint)
}

// Start launches the local dev template live sync loop.
func Start(ctx context.Context, logger *slog.Logger) {
	go newSyncer(configFromEnv(), logger).loop(ctx)
}

func configFromEnv() config {
	appsBaseDir := os.Getenv("APPS_BASE_DIR")
	if appsBaseDir == "" {
		appsBaseDir = defaultAppsBaseDir
	}

	templateDir := os.Getenv("APP_TEMPLATE_DIR")
	if templateDir == "" {
		projectRoot := os.Getenv("PROJECT_ROOT")
		if projectRoot == "" {
			projectRoot = defaultProjectRoot
		}
		templateDir = filepath.Join(projectRoot, "app-templates", "v8")
	}

	return config{
		appsBaseDir: appsBaseDir,
		templateDir: templateDir,
		folders:     append([]string(nil), defaultFolders...),
		excludes:    append([]string(nil), defaultExcludes...),
		poll:        defaultPoll,
		run:         runCommand,
	}
}

func newSyncer(cfg config, logger *slog.Logger) *syncer {
	if logger == nil {
		logger = slog.Default()
	}
	if cfg.run == nil {
		cfg.run = runCommand
	}
	return &syncer{
		cfg:    cfg,
		logger: logger,
		last:   make(map[string]sourceTreeStamp),
	}
}

func (s *syncer) loop(ctx context.Context) {
	s.logger.Info("template.live_sync.start", "apps_base_dir", s.cfg.appsBaseDir, "template_dir", s.cfg.templateDir)
	if err := s.syncOnce(ctx); err != nil {
		s.logger.Warn("template.live_sync.failed", "error", err)
	}

	ticker := time.NewTicker(s.cfg.poll)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			changed, err := s.changedFolders()
			if err != nil {
				s.logger.Warn("template.live_sync.failed", "error", err)
				continue
			}
			if len(changed) == 0 {
				continue
			}

			s.logger.Info("template.live_sync.changed", "folders", changed)
			if err := s.syncOnce(ctx); err != nil {
				s.logger.Warn("template.live_sync.failed", "error", err)
			}
		}
	}
}

func (s *syncer) changedFolders() ([]string, error) {
	var changed []string
	for _, folder := range s.cfg.folders {
		stamp, err := sourceStamp(filepath.Join(s.cfg.templateDir, folder), s.cfg.excludes)
		if err != nil {
			return nil, err
		}
		if stamp.IsZero() {
			continue
		}
		if last, ok := s.last[folder]; !ok || !stamp.Equal(last) {
			changed = append(changed, folder)
		}
	}
	return changed, nil
}

func (s *syncer) syncOnce(ctx context.Context) error {
	var firstErr error
	for _, folder := range s.cfg.folders {
		source := filepath.Join(s.cfg.templateDir, folder)
		stamp, err := sourceStamp(source, s.cfg.excludes)
		if err != nil {
			s.logger.Warn("template.live_sync.failed", "folder", folder, "source", source, "error", err)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if stamp.IsZero() {
			s.logger.Info("template.live_sync.skip", "folder", folder, "source", source, "reason", "source_missing")
			if _, ok := s.last[folder]; !ok {
				s.last[folder] = stamp
			}
			continue
		}
		if last, ok := s.last[folder]; ok && stamp.Equal(last) {
			continue
		}

		if err := s.syncFolder(ctx, folder); err != nil {
			s.logger.Warn("template.live_sync.failed", "folder", folder, "error", err)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		s.last[folder] = stamp
	}
	return firstErr
}

func (s *syncer) syncFolder(ctx context.Context, folder string) error {
	previewRoots, err := discoverPreviewRoots(s.cfg.appsBaseDir)
	if err != nil {
		return err
	}
	if len(previewRoots) == 0 {
		s.logger.Info("template.live_sync.skip", "folder", folder, "reason", "no_previews")
		return nil
	}

	var firstErr error
	for _, previewRoot := range previewRoots {
		if err := s.runRsync(ctx, folder, previewRoot); err != nil {
			s.logger.Warn("template.live_sync.failed", "folder", folder, "preview", previewRoot, "error", err)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		s.logger.Info("template.live_sync.synced", "folder", folder, "preview", previewRoot)
	}
	return firstErr
}

func discoverPreviewRoots(appsBaseDir string) ([]string, error) {
	appsBaseDir = filepath.Clean(appsBaseDir)
	if err := validateAppsBaseDir(appsBaseDir); err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(appsBaseDir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read apps base dir %s: %w", appsBaseDir, err)
	}

	var roots []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		previewRoot := filepath.Join(appsBaseDir, entry.Name(), "preview")
		info, err := os.Lstat(previewRoot)
		if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			continue
		}
		roots = append(roots, previewRoot)
	}
	sort.Strings(roots)
	return roots, nil
}

func validateAppsBaseDir(appsBaseDir string) error {
	if appsBaseDir == "." || appsBaseDir == string(os.PathSeparator) {
		return fmt.Errorf("unsafe apps base dir %s", appsBaseDir)
	}
	homeDir, err := os.UserHomeDir()
	if err == nil && homeDir != "" && appsBaseDir == filepath.Clean(homeDir) {
		return fmt.Errorf("unsafe apps base dir %s", appsBaseDir)
	}
	return nil
}

func sourceStamp(source string, excludes []string) (sourceTreeStamp, error) {
	info, err := os.Stat(source)
	if os.IsNotExist(err) {
		return sourceTreeStamp{}, nil
	}
	if err != nil {
		return sourceTreeStamp{}, fmt.Errorf("stat source %s: %w", source, err)
	}
	if !info.IsDir() {
		return sourceTreeStamp{}, fmt.Errorf("source %s is not a directory", source)
	}

	excluded := make(map[string]bool, len(excludes))
	for _, name := range excludes {
		excluded[name] = true
	}

	hash := fnv.New64a()
	_, _ = fmt.Fprintln(hash, "source")
	err = filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == source {
			return nil
		}
		if entry.IsDir() && excluded[entry.Name()] {
			return filepath.SkipDir
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		kind := "file"
		if entry.IsDir() {
			_, _ = fmt.Fprintf(hash, "dir\t%s\t%o\n", filepath.ToSlash(rel), info.Mode().Perm())
			return nil
		}
		_, _ = fmt.Fprintf(hash, "%s\t%s\t%d\t%d\t%o\n", kind, filepath.ToSlash(rel), info.Size(), info.ModTime().UnixNano(), info.Mode().Perm())
		return nil
	})
	if err != nil {
		return sourceTreeStamp{}, fmt.Errorf("walk source %s: %w", source, err)
	}
	return sourceTreeStamp{exists: true, fingerprint: hash.Sum64()}, nil
}

func (s *syncer) runRsync(ctx context.Context, folder string, previewRoot string) error {
	source := filepath.Join(s.cfg.templateDir, folder)
	destination := filepath.Join(previewRoot, folder)
	if err := requireSafeDirectory(previewRoot, false); err != nil {
		return fmt.Errorf("unsafe preview root %s: %w", previewRoot, err)
	}
	if err := requireSafeDirectory(destination, true); err != nil {
		return fmt.Errorf("unsafe destination %s: %w", destination, err)
	}
	if err := os.MkdirAll(destination, 0o750); err != nil {
		return fmt.Errorf("create destination %s: %w", destination, err)
	}
	if err := requireSafeDirectory(destination, false); err != nil {
		return fmt.Errorf("unsafe destination %s: %w", destination, err)
	}

	args := []string{"-a", "--delete"}
	for _, exclude := range s.cfg.excludes {
		args = append(args, "--exclude", exclude)
	}
	args = append(args, withTrailingSeparator(source), withTrailingSeparator(destination))

	if err := s.cfg.run(ctx, "rsync", args...); err != nil {
		return fmt.Errorf("rsync %s to %s: %w", source, destination, err)
	}
	if err := normalizeGitState(ctx, previewRoot, folder); err != nil {
		return fmt.Errorf("normalize git state for %s in %s: %w", folder, previewRoot, err)
	}
	return nil
}

func requireSafeDirectory(path string, allowMissing bool) error {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) && allowMissing {
		return nil
	}
	if err != nil {
		return fmt.Errorf("lstat directory: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("is a symlink")
	}
	if !info.IsDir() {
		return fmt.Errorf("is not a directory")
	}
	return nil
}

func normalizeGitState(ctx context.Context, previewRoot string, folder string) error {
	gitDir, ok, err := findGitDir(previewRoot)
	if err != nil || !ok {
		return err
	}
	if err := ensureGitExclude(gitDir, folder); err != nil {
		return err
	}

	files, err := gitTrackedFiles(ctx, gitDir, previewRoot, folder)
	if err != nil {
		return err
	}
	for start := 0; start < len(files); start += gitUpdateIndexBatchSize {
		end := start + gitUpdateIndexBatchSize
		if end > len(files) {
			end = len(files)
		}
		if err := gitRun(ctx, gitDir, previewRoot, append([]string{"update-index", "--skip-worktree", "--"}, files[start:end]...)...); err != nil {
			return err
		}
	}
	return nil
}

func findGitDir(previewRoot string) (string, bool, error) {
	for _, gitDir := range []string{
		filepath.Join(previewRoot, ".git"),
		filepath.Join(filepath.Dir(previewRoot), "git-repo", ".git"),
	} {
		info, err := os.Lstat(gitDir)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", false, fmt.Errorf("lstat git dir %s: %w", gitDir, err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", false, fmt.Errorf("git dir %s is a symlink", gitDir)
		}
		if !info.IsDir() {
			continue
		}
		if !isGitDir(gitDir) {
			continue
		}
		return gitDir, true, nil
	}
	return "", false, nil
}

func isGitDir(path string) bool {
	if _, err := os.Stat(filepath.Join(path, "HEAD")); err != nil {
		return false
	}
	if info, err := os.Stat(filepath.Join(path, "objects")); err != nil || !info.IsDir() {
		return false
	}
	return true
}

func ensureGitExclude(gitDir string, folder string) error {
	excludePath := filepath.Clean(filepath.Join(gitDir, "info", "exclude"))
	pattern := "/" + filepath.ToSlash(folder) + "/"

	data, err := os.ReadFile(excludePath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read git exclude %s: %w", excludePath, err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(line) == pattern {
			return nil
		}
	}

	if err := os.MkdirAll(filepath.Dir(excludePath), 0o700); err != nil {
		return fmt.Errorf("create git exclude dir %s: %w", filepath.Dir(excludePath), err)
	}
	file, err := os.OpenFile(excludePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return fmt.Errorf("open git exclude %s: %w", excludePath, err)
	}
	defer func() {
		_ = file.Close()
	}()

	if len(data) > 0 && !strings.HasSuffix(string(data), "\n") {
		if _, err := file.WriteString("\n"); err != nil {
			return fmt.Errorf("write git exclude %s: %w", excludePath, err)
		}
	}
	if _, err := file.WriteString(pattern + "\n"); err != nil {
		return fmt.Errorf("write git exclude %s: %w", excludePath, err)
	}
	return nil
}

func gitTrackedFiles(ctx context.Context, gitDir string, workTree string, folder string) ([]string, error) {
	output, err := gitOutput(ctx, gitDir, workTree, "ls-files", "-z", "--", folder)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, file := range strings.Split(string(output), "\x00") {
		if file != "" {
			files = append(files, file)
		}
	}
	return files, nil
}

func gitRun(ctx context.Context, gitDir string, workTree string, args ...string) error {
	_, err := gitOutput(ctx, gitDir, workTree, args...)
	return err
}

func gitOutput(ctx context.Context, gitDir string, workTree string, args ...string) ([]byte, error) {
	gitArgs := []string{"--git-dir", gitDir, "--work-tree", workTree}
	gitArgs = append(gitArgs, args...)
	output, err := exec.CommandContext(ctx, "git", gitArgs...).CombinedOutput()
	if err == nil {
		return output, nil
	}
	if len(output) == 0 {
		return nil, fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
	}
	return nil, fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
}

func withTrailingSeparator(path string) string {
	if strings.HasSuffix(path, string(os.PathSeparator)) {
		return path
	}
	return path + string(os.PathSeparator)
}

func runCommand(ctx context.Context, name string, args ...string) error {
	if name != "rsync" {
		return fmt.Errorf("unsupported command %s", name)
	}
	output, err := exec.CommandContext(ctx, "rsync", args...).CombinedOutput()
	if err == nil {
		return nil
	}
	if len(output) == 0 {
		return fmt.Errorf("rsync: %w", err)
	}
	return fmt.Errorf("rsync: %w: %s", err, strings.TrimSpace(string(output)))
}
