# Filesystem and Persistent Storage

## Overview

You work from the application root directory. Use **relative paths** for app files, **absolute paths** for `/private`.

## Storage Locations

### `public/assets/` - Public Persistent Files

- **Purpose:** User uploads, images, media that need public web access
- **Path:** Relative (e.g., `public/assets/profiles/user-123.jpg`)
- **Access:** Publicly served via HTTP
- **Persistence:** Yes (survives restarts)
- **Example:** `await fs.writeFile('public/assets/profiles/${userId}.jpg', buffer)`

### `/private/` - Private Persistent Files

- **Purpose:** Documents, reports, sensitive data that require authentication
- **Path:** Absolute (e.g., `/private/documents/user-123/doc.pdf`)
- **Access:** NOT web-accessible, requires app-level auth
- **Persistence:** Yes (survives restarts)
- **Security:** Isolated from web server, never expose these paths publicly
- **Example:** `await fs.writeFile('/private/documents/${userId}/${docId}.pdf', buffer)`

### Working Directory - Ephemeral Files

- **Purpose:** Application code (`.tsx`, `.ts`, config files)
- **Path:** Relative (e.g., `src/components/Button.tsx`)
- **Persistence:** Only via git commits (auto-restored on restart)
- **Not for:** User-generated content

## Storage Decision Matrix

| File Type            | Public Access? | Persisted?    | Location                  | Example           |
| -------------------- | -------------- | ------------- | ------------------------- | ----------------- |
| User profile image   | Yes            | Yes           | `public/assets/profiles/` | `avatar.jpg`      |
| Product photo        | Yes            | Yes           | `public/assets/products/` | `product-123.png` |
| Generated PDF report | No             | Yes           | `/private/reports/`       | `report-456.pdf`  |
| User document        | No             | Yes           | `/private/documents/`     | `invoice.pdf`     |
| Application code     | N/A            | Yes (via git) | `src/`                    | `component.tsx`   |
| Temp processing file | No             | No            | `/tmp/`                   | `temp-upload.bin` |
| Build artifacts      | No             | Yes           | `dist/`                   | `bundle.js`       |

## Best Practices

- Use relative paths for `public/assets/` and app code
- Use absolute path `/private/` for sensitive files
- Organize with subdirectories (by user ID, date, category)
- Validate paths to prevent directory traversal
- Never expose `/private/` paths in API responses
- Always authenticate before serving from `/private/`
- Handle file operation errors gracefully
