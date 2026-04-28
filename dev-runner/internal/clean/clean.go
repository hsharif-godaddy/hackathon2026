package clean

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// managedEnvFiles is the full list of env files written by dev-runner preflight.
var managedEnvFiles = []string{
	"agents/.env",
	"agents/.env.local.dev",
	"agents/.env.local.test",
	"agents/.env.local.prod",
	"app/.env",
	"app/.env.local.dev",
	"app/.env.local.test",
	"app/.env.local.prod",
	"design-rag/.env",
	"image-search-service/.env",
	"image-search-service/certs/client.crt",
	"image-search-service/certs/client.key",
	"local-control-plane/.env",
}

// managedDataFiles are runtime state files created when services first start.
var managedDataFiles = []string{
	"local-control-plane/local-control-plane.db",
	"local-control-plane/local-control-plane.db-shm",
	"local-control-plane/local-control-plane.db-wal",
}

type goService struct {
	dir       string
	artifacts []string // what make clean actually removes, for display only
}

// goServices lists each Go service alongside the specific artifacts its
// Makefile clean target removes, so the confirmation output is unambiguous.
var goServices = []goService{
	{"dev-runner", []string{"dist/"}},
	{"dev-supervisor", []string{"dist/"}},
	{"local-control-plane", []string{"dist/"}},
	{"budget-service", []string{"bin/", "tmp/"}},
	{"image-search-service", []string{"dist/"}},
	{"knowledge-service", []string{"dist/"}},
	{"go-agent", []string{"dist/", "coverage.out", "coverage.html"}},
	{"release-manager", []string{"dist/"}},
	{"cli-agent-client", []string{"bin/"}},
}

// Run removes generated env files, runtime data files, and Go service build
// artifacts from the project root after user confirmation.
// Pass skipConfirm=true (via --yes / -y) to suppress the interactive prompt.
func Run(projectRoot string, skipConfirm bool) error {
	return run(projectRoot, skipConfirm, os.Stdout, os.Stderr, os.Stdin)
}

func run(projectRoot string, skipConfirm bool, out, errOut io.Writer, in io.Reader) error {
	var filesToRemove []string
	for _, rel := range append(managedEnvFiles, managedDataFiles...) {
		_, err := os.Stat(filepath.Join(projectRoot, rel))
		if err == nil {
			filesToRemove = append(filesToRemove, rel)
			continue
		}
		if !errors.Is(err, os.ErrNotExist) {
			fmt.Fprintf(errOut, "  warning: cannot stat %s: %v (skipping)\n", rel, err)
		}
	}

	var servicesToClean []goService
	for _, svc := range goServices {
		_, err := os.Stat(filepath.Join(projectRoot, svc.dir, "Makefile"))
		if err == nil {
			servicesToClean = append(servicesToClean, svc)
			continue
		}
		if !errors.Is(err, os.ErrNotExist) {
			fmt.Fprintf(errOut, "  warning: cannot stat %s/Makefile: %v (skipping)\n", svc.dir, err)
		}
	}

	if len(filesToRemove) == 0 && len(servicesToClean) == 0 {
		fmt.Fprintln(out, "Nothing to clean.")
		return nil
	}

	if len(filesToRemove) > 0 {
		fmt.Fprintln(out, "Generated files to delete:")
		for _, f := range filesToRemove {
			fmt.Fprintf(out, "  %s\n", f)
		}
		fmt.Fprintln(out)
	}

	if len(servicesToClean) > 0 {
		fmt.Fprintln(out, "Build artifacts to delete:")
		for _, svc := range servicesToClean {
			fmt.Fprintf(out, "  %s/{%s}\n", svc.dir, strings.Join(svc.artifacts, ", "))
		}
		fmt.Fprintln(out)
	}

	fmt.Fprintln(out, "Note: /etc/hosts entry for local.gasket.dev-godaddy.com must be removed manually.")
	fmt.Fprintln(out)

	if !skipConfirm {
		fmt.Fprint(out, "Are you sure? [y/N]: ")
		reader := bufio.NewReader(in)
		answer, err := reader.ReadString('\n')
		if err != nil {
			if errors.Is(err, io.EOF) {
				fmt.Fprintln(out, "Cancelled (no confirmation received).")
				return nil
			}
			return fmt.Errorf("reading confirmation: %w", err)
		}
		answer = strings.TrimSpace(strings.ToLower(answer))
		if answer != "y" && answer != "yes" {
			fmt.Fprintln(out, "Cancelled.")
			return nil
		}
	}

	var failed int
	var failedNames []string

	for _, rel := range filesToRemove {
		if err := os.Remove(filepath.Join(projectRoot, rel)); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			fmt.Fprintf(errOut, "  error removing %s: %v\n", rel, err)
			failed++
			failedNames = append(failedNames, rel)
		} else {
			fmt.Fprintf(out, "  removed %s\n", rel)
		}
	}

	for _, svc := range servicesToClean {
		fmt.Fprintf(out, "  cleaning %s/{%s}\n", svc.dir, strings.Join(svc.artifacts, ", "))
		cmd := exec.Command("make", "clean")
		cmd.Dir = filepath.Join(projectRoot, svc.dir)
		cmd.Env = append(os.Environ(), "GOPROXY=off")
		cmd.Stdout = out
		cmd.Stderr = errOut
		if err := cmd.Run(); err != nil {
			fmt.Fprintf(errOut, "  error cleaning %s: %v\n", svc.dir, err)
			failed++
			failedNames = append(failedNames, svc.dir)
		}
	}

	if failed > 0 {
		return fmt.Errorf("%d item(s) could not be cleaned: %s", failed, strings.Join(failedNames, ", "))
	}

	fmt.Fprintln(out)
	fmt.Fprintln(out, "Done. Run 'pnpm run dev' to regenerate.")
	return nil
}
