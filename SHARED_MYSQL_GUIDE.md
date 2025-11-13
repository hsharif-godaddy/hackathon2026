# Shared MySQL Architecture Guide

## Overview

Generated applications now use a single shared MySQL instance (`airo-app-mysql`) instead of per-app MySQL containers. Each app gets its own isolated database and user within the shared instance.

## Architecture

### Before (Per-App MySQL)

```
App 1 → MySQL Container 1 (port 33060) → Volume 1
App 2 → MySQL Container 2 (port 33061) → Volume 2
App 3 → MySQL Container 3 (port 33062) → Volume 3
```

### After (Shared MySQL)

```
App 1 → Shared MySQL (port 3306)
          ├─ Database: airo_app1 (user: user_airo_app1)
App 2 →   ├─ Database: airo_app2 (user: user_airo_app2)
App 3 →   └─ Database: airo_app3 (user: user_airo_app3)
```

## Benefits

1. **Resource Efficiency**: Eliminates overhead of running multiple MySQL containers
2. **Production Parity**: Better models how production databases work (shared instance, isolated schemas)
3. **Simpler Networking**: Single MySQL container on shared network
4. **Faster Startup**: No waiting for per-app MySQL container health checks
5. **Easier Management**: Single place to inspect all app databases

## Database Naming Convention

- **Database**: `airo_{appId}` (sanitized, max 40 chars)
- **User**: `user_airo_{appId}` (sanitized, max 32 chars)
- **Password**: 32-character random hex (unique per app)

### Sanitization Rules

- Lowercase only
- Alphanumeric + underscores
- Multiple underscores collapsed to one
- Leading/trailing underscores removed
- Throws error if result is empty

## Lifecycle

### App Creation

1. `SharedMySQLService.initialize()` - Health check and network setup
2. `SharedMySQLService.provisionDatabase(appId)` - Create database and user
3. Docker Compose generates app container (no database service)
4. App starts and connects to shared MySQL

### App Deletion

1. Docker Compose removes app container
2. `SharedMySQLService.dropDatabase(appId)` - Drop database and user
3. Complete cleanup (no orphaned databases)

## Connection Details

### From App Container

- **Host**: `airo-app-mysql` (Docker network DNS)
- **Port**: `3306`
- **Database**: `airo_{appId}`
- **User**: `user_airo_{appId}`
- **Password**: Generated during provisioning

### From Host Machine

- **Host**: `localhost`
- **Port**: `3306`
- **Database**: `airo_{appId}`
- **User**: `user_airo_{appId}`
- **Password**: Stored in `/tmp/apps/{appId}/.env`

### From Agents Service

Same as host machine (agents service runs on host, reads `.env` file)

## Environment Variables

Each app's `.env` file contains:

```bash
DATABASE_URL=mysql://user_airo_{appId}:password@airo-app-mysql:3306/airo_{appId}?sslaccept=accept_invalid_certs
MYSQL_HOST=airo-app-mysql
MYSQL_PORT=3306
MYSQL_DATABASE=airo_{appId}
MYSQL_USER=user_airo_{appId}
MYSQL_PASSWORD={generated}
```

## Security

- **Isolated Access**: Each user can only access their own database
- **Strong Passwords**: 32-character random hex (128 bits of entropy)
- **SQL Injection Protected**: All queries use parameterized/identifier escaping
- **Connection Pooling**: Proper cleanup prevents resource exhaustion
- **No Cross-App Access**: `GRANT ALL ON airo_{appId}.* TO user_airo_{appId}@'%'`

## Troubleshooting

### Check Shared MySQL Status

```bash
docker ps | grep airo-app-mysql
```

### List All App Databases

```bash
docker exec -it airo-app-mysql mysql -uroot -prootpassword -e "SHOW DATABASES LIKE 'airo_%';"
```

### Check App User Permissions

```bash
docker exec -it airo-app-mysql mysql -uroot -prootpassword -e "SHOW GRANTS FOR 'user_airo_<appId>'@'%';"
```

### View App Database

```bash
docker exec -it airo-app-mysql mysql -uroot -prootpassword airo_<appId>
```

### Check Network Connectivity

```bash
docker network inspect airo-network
```

### View App Connection Details

```bash
cat /tmp/apps/<appId>/.env | grep MYSQL
```

## Error Handling

### Database Provisioning Fails

- Database and user automatically cleaned up
- Error logged with full context
- Container creation aborted
- Safe to retry

### Container Creation Fails After Provisioning

- Database and user automatically dropped
- No orphaned databases left behind
- Cleanup logged for debugging

### Network Issues

- Shared MySQL connected to `airo-network` (created by root docker-compose.yml)
- Generated apps also connect to `airo-network`
- All services can communicate via Docker DNS

## Migration from Per-App MySQL

**⚠️ BREAKING CHANGE - No automatic migration**

### Steps:

1. **Backup any important data** from existing apps
2. Delete existing apps (removes per-app MySQL containers)
3. Recreate apps (will use shared MySQL)

### Data Migration (if needed):

```bash
# Export from old per-app MySQL
docker exec old-mysql-container mysqldump -u appuser -pOLDPASS appdb > backup.sql

# Import to shared MySQL
docker exec -i airo-app-mysql mysql -uroot -prootpassword airo_<appId> < backup.sql
```

## Key Files

- **`app/src/lib/dev-environment/services/shared-mysql-service.ts`** - Core provisioning service
- **`app/src/lib/dev-environment/services/docker-compose-generator.ts`** - Compose file generation (no db service)
- **`app/src/lib/dev-environment/services/docker-container-manager.ts`** - Lifecycle integration
- **`app/src/lib/dev-environment/utils/password-generator.ts`** - Secure password generation
- **`app/src/lib/dev-environment/utils/sanitizers.ts`** - ID sanitization utilities
- **`docker-compose.yml`** - Shared MySQL configuration with network bridge

## Testing

### Manual Test

```bash
# 1. Start shared MySQL
docker compose up -d app-mysql

# 2. Start application
pnpm run dev

# 3. Create a test app via UI
# (Check logs for "shared_mysql.provision.success")

# 4. Verify database created
docker exec -it airo-app-mysql mysql -uroot -prootpassword -e "SHOW DATABASES LIKE 'airo_%';"

# 5. Delete the app via UI
# (Check logs for "shared_mysql.drop.success")

# 6. Verify database deleted
docker exec -it airo-app-mysql mysql -uroot -prootpassword -e "SHOW DATABASES LIKE 'airo_%';"
```

### Integration Test

```bash
# Run full test suite
pnpm --filter website test

# Type check
pnpm --filter website typecheck
```

## Performance Notes

- **Database Creation**: ~100-200ms (3 SQL commands)
- **Database Deletion**: ~50-100ms (2 SQL commands)
- **Health Check**: 2s intervals, max 30 attempts (60s total)
- **Connection Pooling**: mysql2 default settings (10 connections)
- **No Impact**: App startup time (database created in parallel)

## Future Enhancements

- [ ] Database backup automation
- [ ] Periodic cleanup of orphaned databases
- [ ] Database size monitoring/limits
- [ ] Migration to PostgreSQL support
- [ ] Read replica support
- [ ] Connection pooling optimization
