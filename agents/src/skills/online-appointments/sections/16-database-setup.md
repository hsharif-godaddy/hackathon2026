# §16 Database Setup

Complete guide to configuring MySQL + Drizzle ORM for the appointments system.

---

## Step 1 — Install the database skill

**The database skill must be installed first.** It provisions the connection infrastructure that appointments builds on.

```typescript
skill({ action: 'install', skill: 'database' })
```

This installs three IMMUTABLE files — **do not modify them:**

| File | Role |
|---|---|
| `src/server/db/config.ts` | Credential loader — reads from `$NOMAD_TASK_DIR/config.json` |
| `src/server/db/client.ts` | MySQL connection pool with SSL |
| `drizzle.config.ts` | Migration config — uses `getDatabaseCredentials()` from `config.ts` |

### How credentials are loaded

`getDatabaseCredentials()` in `src/server/db/config.ts` reads from the Nomad task config file:

```
$NOMAD_TASK_DIR/config.json  →  defaults to /local/config.json
```

Expected structure:

```json
{
  "DATABASE": {
    "VALUE": {
      "HOST": "...",
      "PORT": 3306,
      "USERNAME": "...",
      "PASSWORD": "...",
      "NAME": "..."
    }
  }
}
```

The `drizzle.config.ts` passes these as individual credentials with `ssl: { rejectUnauthorized: false }`. **There is no `DATABASE_URL` environment variable** — credentials come exclusively from this config file.

---

## Step 2 — Verify the appointments schema is installed

The online-appointments template installs `src/server/db/schema.ts` with all appointments tables. After `skill({ action: 'install', skill: 'online-appointments' })`, confirm the file exists and contains the appointments schema.

The appointments schema defines these tables:

```
user_credential     staff               client
contact_detail      service             service_category
service_staff       service_snapshot    booking
question            question_response   coupon
availability        exception_time      business_setting
```

---

## Step 3 — Run migrations

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

**Do not use `drizzle-kit push`** — it does not support the SSL configuration that the database skill sets up.

---

## Step 4 — Verify tables created

Confirm all 15 tables exist:

```typescript
database__listTables({})
```

Cross-check the output against the expected table list in Step 2. If any tables are missing, the migration was incomplete — re-run `npx drizzle-kit generate` and `npx drizzle-kit migrate`.

All tables are created regardless of which features are enabled — disabling a feature hides the UI, not the underlying table.

---

## Troubleshooting

### `Database configuration file not found at /local/config.json`

**Cause:** The Nomad task config file is not present. This happens when running outside of the Nomad/Airo runtime.

**Fix:** The database is provisioned by the Airo platform when the app is deployed. Ensure you are running the app via the Airo builder environment where the config file is injected.

### Migration generates an incomplete SQL file (only some tables)

**Cause:** Drizzle sometimes generates a partial migration if a previous migration exists or if the schema file has import errors.

**Fix:**
1. Delete any existing files in `drizzle/` (or wherever `out` points in `drizzle.config.ts`)
2. Re-run `npx drizzle-kit generate`
3. Inspect the generated `.sql` file — it should contain 15 `CREATE TABLE` statements

### `setup endpoint returns "Setup failed"` after migration

**Cause:** Required tables (`user_credential`, `staff`) are missing — migration ran partially.

**Fix:** Run `database__listTables({})` to see what exists, then re-run the migration for any missing tables.

### `drizzle-kit push` SSL error

**Cause:** `drizzle-kit push` does not support the SSL object format used in `drizzle.config.ts`.

**Fix:** Always use `drizzle-kit generate` + `drizzle-kit migrate` — never `push`.

---

## Next — load these sections now

Database is set up. Immediately load the following before continuing:

```typescript
skill({ action: 'loadReference', path: 'online-appointments/sections/14-admin-system' })
skill({ action: 'loadReference', path: 'online-appointments/sections/15-authentication' })
skill({ action: 'loadReference', path: 'online-appointments/sections/11-seeding' })
```
