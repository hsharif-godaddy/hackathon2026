package docker

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
)

const mysqlContainer = "airo-app-mysql"

// ProvisionDatabase creates a MySQL database and user for an app in the shared MySQL instance.
// Returns the generated password. Idempotent (uses IF NOT EXISTS).
func ProvisionDatabase(appID string) (dbName, username, password string, err error) {
	rootPassword := os.Getenv("MYSQL_ROOT_PASSWORD")
	if rootPassword == "" {
		rootPassword = "rootpassword"
	}

	dbName = "airo_" + sanitizeForMySQL(appID)
	username = generateUsername(appID)
	password, err = generatePassword()
	if err != nil {
		return "", "", "", err
	}

	sql := fmt.Sprintf(
		"CREATE DATABASE IF NOT EXISTS `%s`; "+
			"CREATE USER IF NOT EXISTS '%s'@'%%' IDENTIFIED BY '%s'; "+
			"GRANT ALL PRIVILEGES ON `%s`.* TO '%s'@'%%'; "+
			"FLUSH PRIVILEGES;",
		dbName, username, password, dbName, username,
	)

	cmd := exec.Command("docker", "exec", "-i",
		"-e", "MYSQL_PWD="+rootPassword,
		mysqlContainer,
		"mysql", "-uroot",
	)
	cmd.Stdin = strings.NewReader(sql)
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return "", "", "", fmt.Errorf("provision database for %s: %w", appID, err)
	}

	slog.Info("mysql.provision.success", "app_id", appID, "database", dbName, "user", username)
	return dbName, username, password, nil
}

// DropDatabase removes the database and user for an app. Idempotent.
func DropDatabase(appID string) error {
	rootPassword := os.Getenv("MYSQL_ROOT_PASSWORD")
	if rootPassword == "" {
		rootPassword = "rootpassword"
	}

	dbName := "airo_" + sanitizeForMySQL(appID)
	username := generateUsername(appID)

	sql := fmt.Sprintf(
		"DROP DATABASE IF EXISTS `%s`; "+
			"DROP USER IF EXISTS '%s'@'%%';",
		dbName, username,
	)

	cmd := exec.Command("docker", "exec", "-i",
		"-e", "MYSQL_PWD="+rootPassword,
		mysqlContainer,
		"mysql", "-uroot",
	)
	cmd.Stdin = strings.NewReader(sql)
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		slog.Warn("mysql.drop.failed", "app_id", appID, "error", err)
		return err
	}

	slog.Info("mysql.drop.success", "app_id", appID)
	return nil
}

func sanitizeForMySQL(appID string) string {
	var b strings.Builder
	for _, c := range appID {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			b.WriteRune(c)
		}
	}
	return b.String()
}

func generateUsername(appID string) string {
	username := "user_airo_" + sanitizeForMySQL(appID)
	if len(username) > 32 {
		username = username[:32]
	}
	return username
}

func generatePassword() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate random password: %w", err)
	}
	return hex.EncodeToString(b), nil
}
