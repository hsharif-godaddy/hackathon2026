# Filesystem and Persistent Storage

## Overview

You work from the application root directory. Use **relative paths** for app files, **absolute paths** for `/shared-storage/private`.

## Storage Locations

### Media Files (Images, Videos, Uploads)

Media is handled automatically by tools (media slot, image editor, video generation, etc.). You do **not** need to manually write files to a media directory — the tools save to persistent storage and return a URL you can use in source code.

Use the URL pattern `/airo-assets/uploads/{filename}` in source code for any media generated or uploaded by tools.

### `/shared-storage/private/` - Private Persistent Files

- **Purpose:** Documents, reports, sensitive data that require authentication
- **Path:** Absolute (e.g., `/shared-storage/private/documents/user-123/doc.pdf`)
- **Access:** NOT web-accessible, requires app-level auth
- **Persistence:** Yes (survives restarts)
- **Security:** Isolated from web server, never expose these paths publicly
- **Example:** `await fs.writeFile('/shared-storage/private/documents/${userId}/${docId}.pdf', buffer)`

### Working Directory - Application Code

- **Purpose:** Application code (`.tsx`, `.ts`, config files)
- **Path:** Relative (e.g., `src/components/Button.tsx`)
- **Persistence:** Application code is version controlled through git
- **Not for:** User-generated content

## Storage Decision Matrix

| File Type            | Public Access? | Persisted? | How                                 | Example                                         |
| -------------------- | -------------- | ---------- | ----------------------------------- | ----------------------------------------------- |
| User uploaded image  | Yes            | Yes        | Use media slot upload tool          | URL: `/airo-assets/uploads/photo.jpg`           |
| AI-generated image   | Yes            | Yes        | Use image editor tool               | URL: `/airo-assets/uploads/hero.png`            |
| Generated PDF report | No             | Yes        | Write to `/shared-storage/private/` | `/shared-storage/private/reports/report.pdf`    |
| User document        | No             | Yes        | Write to `/shared-storage/private/` | `/shared-storage/private/documents/invoice.pdf` |
| Application code     | N/A            | Yes        | Edit source files                   | `src/component.tsx`                             |
| Temp processing file | No             | No         | Write to `/tmp/`                    | `/tmp/temp-upload.bin`                          |

## Best Practices

- Use relative paths for app code
- Use absolute path `/shared-storage/private/` for sensitive files
- Organize with subdirectories (by user ID, date, category)
- Validate paths to prevent directory traversal
- Never expose `/shared-storage/private/` paths in API responses
- Always authenticate before serving from `/shared-storage/private/`
- Handle file operation errors gracefully
- Do NOT write media files to `public/` — use the provided tools instead
