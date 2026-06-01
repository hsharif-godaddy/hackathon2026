# Filesystem and Persistent Storage

Use **relative paths** for app files and **absolute paths** for `{{persistentPublicPath}}` and `{{persistentPrivatePath}}`.

## Storage Locations

### Media Files (Images, Videos, Uploads)

Media is handled automatically by tools (media slot, image editor, video generation, etc.). You do **not** need to manually write files to a media directory — the tools save to persistent storage and return a URL you can use in source code.

Use the URL pattern `/airo-assets/uploads/{filename}` in source code for any media generated or uploaded by tools. Subdirectories are supported for organization (e.g., `/airo-assets/uploads/pdfs/document.pdf`).

### `{{persistentPublicPath}}/` - Runtime User Uploads

- **Purpose:** Files uploaded by **end-users of the deployed app** at runtime (profile pictures, documents, content they create)
- **Path:** Absolute (e.g., `{{persistentPublicPath}}/uploads/${filename}`)
- **Access:** Web-accessible via `/airo-assets/uploads/` URLs
- **Persistence:** Yes (survives restarts and deployments)
- **Example endpoint pattern:**
  ```typescript
  // POST /api/upload - end-user uploads their profile picture
  const filename = `avatars/${userId}-${Date.now()}.jpg`;
  const uploadPath = `{{persistentPublicPath}}/uploads/${filename}`;
  await fs.mkdir(path.dirname(uploadPath), { recursive: true });
  await fs.writeFile(uploadPath, buffer);
  res.json({ url: `/airo-assets/uploads/${filename}` });
  ```

### `{{persistentPrivatePath}}/` - Private Persistent Files

- **Purpose:** Documents, reports, sensitive data that require authentication
- **Path:** Absolute (e.g., `{{persistentPrivatePath}}/documents/user-123/doc.pdf`)
- **Access:** Not web-accessible, requires app-level auth
- **Persistence:** Yes (survives restarts)
- **Example:**
  ```typescript
  await fs.writeFile(`{{persistentPrivatePath}}/documents/${userId}/${docId}.pdf`, buffer);
  ```

### Working Directory - Application Code

- **Purpose:** Application code (`.tsx`, `.ts`, config files)
- **Path:** Relative (e.g., `src/components/Button.tsx`)
- **Persistence:** Application code is version controlled through git
- **Not for:** User-generated content

## Storage Decision Matrix

| File Type                          | Public Access? | Persisted? | How                                   | Example                                           |
| ---------------------------------- | -------------- | ---------- | ------------------------------------- | ------------------------------------------------- |
| Development: Media slot upload     | Yes            | Yes        | Use media slot upload tool            | URL: `/airo-assets/uploads/photo.jpg`             |
| Development: AI-generated image    | Yes            | Yes        | Use image editor tool                 | URL: `/airo-assets/uploads/hero.png`              |
| Runtime: End-user file upload      | Yes            | Yes        | Write to `{{persistentPublicPath}}/`  | `{{persistentPublicPath}}/uploads/avatar.jpg`     |
| Runtime: Generated PDF report      | No             | Yes        | Write to `{{persistentPrivatePath}}/` | `{{persistentPrivatePath}}/reports/report.pdf`    |
| Runtime: End-user private document | No             | Yes        | Write to `{{persistentPrivatePath}}/` | `{{persistentPrivatePath}}/documents/invoice.pdf` |
| Application code                   | N/A            | Yes        | Edit source files                     | `src/component.tsx`                               |
| Temp processing file               | No             | No         | Write to `/tmp/`                      | `/tmp/temp-upload.bin`                            |

## Best Practices

- Organize with subdirectories (by user ID, date, category)
- Validate paths to prevent directory traversal
- Never expose `{{persistentPrivatePath}}/` paths in API responses
- Always authenticate before serving from `{{persistentPrivatePath}}/`
