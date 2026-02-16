# File Manager Design

**Date:** 2026-02-03
**Status:** Design
**Product:** AiroAppBuilder only

## Problem Statement

The current file management system has significant limitations:

1. **External dependency:** Uses @wsb/image-manager-loader from WSB, uploading to external domains (img1.wsimg.com)
2. **Media-only:** Limited to images and videos, cannot handle fonts, JSON, PDFs, or other assets
3. **Delayed integration:** Files uploaded externally, then referenced by agent, not immediately in project
4. **No file operations in Code Preview:** Cannot create, upload, or delete files from the code editor interface
5. **No destination control:** Agent decides where files go, user cannot specify target folders

## Goals

1. Replace external @wsb/image-manager-loader with internal file management system
2. Support almost any file type (images, fonts, JSON, CSV, PDFs, etc.) with security blocklist
3. Enable two upload contexts:
   - **Chat uploads:** For LLM context (screenshots, mockups) with automatic agent integration
   - **Code Preview uploads:** Direct file creation/upload to specific project folders
4. Provide full CRUD operations on files within Code Preview
5. Automatic file movement: Agent transparently moves files from staging to project when used

## Non-Goals

- Image/text editing capabilities (deferred to future iteration)
- Archive file support (.zip, .tar, etc.) - blocked for security
- Staging area for organizing uploads before adding to project
- Batch file operations or advanced file management features

## Architecture Overview

### Three Upload Contexts

#### 1. Chat Uploads → `/tmp/uploads/{appId}/{uploadId}/`

**Purpose:** Files for LLM context (screenshots, design mockups, assets to be used)

**Flow:**

- User clicks "+" button in chat → OS file picker
- Files upload to `/tmp/uploads/{appId}/{uploadId}/`
- Display inline preview in chat:
  - Images: Thumbnail with X to remove
  - Other files: Icon + filename + extension badge with X to remove
- Agent sees files in conversation context automatically
- When agent references file in code, file-edit tool auto-moves from `/tmp/uploads/` to project
- 24-hour expiry (existing cleanup process)

**Example:**

```
User: [uploads logo.png]
User: "use this logo in the header"
Agent: [writes code with /public/assets/logo.png]
→ file-edit tool automatically moves logo.png from /tmp/uploads/ to /public/assets/
```

#### 2. Code Preview Direct Upload → Project directory

**Purpose:** Add files directly to specific folders in project structure

**Flow:**

- User browses to folder in Code Preview file tree
- Clicks "Upload Files" button or right-clicks folder → "Upload Files Here"
- OS file picker opens (multiple selection)
- Files uploaded directly to that project directory via new API endpoint
- File tree refreshes to show new files immediately
- No agent involvement, no `/tmp/uploads/` staging

**Example:**

```
User navigates to /src/assets/fonts/
User clicks "Upload Files" → selects Inter-Regular.ttf
→ File immediately added to /tmp/apps/{appId}/app/src/assets/fonts/Inter-Regular.ttf
```

#### 3. Code Preview New File → Project directory

**Purpose:** Create empty files at specific locations

**Flow:**

- User clicks "New File" button or right-clicks folder → "New File Here"
- Modal prompts for filename
- Calls file-edit tool with mode: 'create', empty content
- File tree refreshes to show new file

### File Movement Logic

When agent's file-edit tool is called:

```typescript
// Pseudo-code
async function resolveFilePath(targetPath: string, appId: string) {
  // 1. Check if file already exists in project
  if (fileExistsInProject(targetPath)) {
    return targetPath;
  }

  // 2. Check if file with same name exists in /tmp/uploads/{appId}/
  const uploadedFile = findInUploads(appId, basename(targetPath));
  if (uploadedFile) {
    // Auto-move from uploads to target location
    await moveFile(uploadedFile.path, targetPath);
    logger.info("file-edit.auto-move", {
      from: uploadedFile.path,
      to: targetPath,
    });
    return targetPath;
  }

  // 3. File doesn't exist anywhere
  throw new Error(`File not found: ${targetPath}`);
}
```

## Backend Implementation

### FileUploadService Updates

**File:** `agents/src/services/FileUploadService.ts`

**Changes:**

1. **Remove file type restrictions** (lines 26-32)
   - Replace ALLOWED_IMAGE_TYPES whitelist with BLOCKED_FILE_TYPES blocklist
   - Add validation method: `validateFileType(mimetype: string, filename: string)`

2. **Add file listing method:**

   ```typescript
   async listUploadedFiles(appId: string): Promise<UploadedFile[]>
   ```

   - Returns all files across all upload sessions for an app
   - Used by UI to display available uploads if needed

3. **Keep existing:**
   - 24-hour expiry cleanup
   - 10MB file size limit
   - Max 5 files per upload
   - Safe path validation

**File Type Security:**

```typescript
const BLOCKED_EXTENSIONS = new Set([
  // Server-side executables
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  // Server-side scripts
  ".php",
  ".jsp",
  ".asp",
  ".aspx",
  // Shell scripts
  ".sh",
  ".bat",
  ".cmd",
  ".ps1",
  // Database files
  ".sql",
  ".db",
  // Archives
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
]);

const BLOCKED_MIME_TYPES = new Set([
  "application/x-executable",
  "application/x-msdownload",
  "application/x-sh",
  "application/x-php",
  // etc.
]);
```

**Allowed file types:**

- Images: `.jpg`, `.png`, `.gif`, `.webp`, `.svg`, `.ico`
- Documents: `.pdf`, `.txt`, `.md`, `.csv`
- Fonts: `.ttf`, `.otf`, `.woff`, `.woff2`
- Media: `.mp4`, `.webm`, `.mp3`, `.wav`
- Data: `.json`, `.xml`, `.yaml`, `.yml`
- Code: `.js`, `.ts`, `.jsx`, `.tsx`, `.css`, `.html`

### file-edit Tool Enhancement

**File:** `agents/src/tools/file-edit.ts`

**Add file resolution logic:**

```typescript
// Before writing/creating a file
async function resolveSourceFile(targetPath: string, appId: string) {
  const filename = path.basename(targetPath);

  // Check uploads directory
  const uploadsDir = `/tmp/uploads/${appId}`;
  const uploadDirs = await fs.readdir(uploadsDir);

  for (const uploadId of uploadDirs) {
    const uploadPath = path.join(uploadsDir, uploadId);
    const files = await fs.readdir(uploadPath);

    const matchingFile = files.find((f) => f === filename);
    if (matchingFile) {
      const sourcePath = path.join(uploadPath, matchingFile);
      // Copy file to target location
      await fs.copyFile(sourcePath, targetPath);

      logger.info("file-edit.auto-resolved", {
        appId,
        filename,
        from: sourcePath,
        to: targetPath,
      });

      return true;
    }
  }

  return false;
}
```

**Integration points:**

- Call `resolveSourceFile()` in `create` and `rewrite` modes before writing
- If file found in uploads, copy to target location
- Continue with normal file-edit operation

### New API Routes

**File:** `agents/src/server/routes/files.ts`

**Add endpoint:**

```typescript
// POST /apps/:appId/files/direct-upload
// Upload files directly to project directory
router.post(
  "/apps/:appId/files/direct-upload",
  validateAppOwnership,
  upload.array("files", 5),
  async (req, res) => {
    const { appId } = req.params;
    const { targetPath } = req.body; // Relative path from app root
    const files = req.files as Express.Multer.File[];

    // Validate targetPath is within app directory
    const safePath = createSafePathBuilder(appBasePath).join(targetPath);

    // Write files to project
    const createdFiles = [];
    for (const file of files) {
      const filePath = path.join(safePath, file.originalname);
      await fs.writeFile(filePath, file.buffer);
      createdFiles.push({
        path: path.relative(appBasePath, filePath),
        name: file.originalname,
        size: file.size,
      });
    }

    return res.json({ success: true, files: createdFiles });
  },
);
```

**Security:**

- Protected by `validateAppOwnership` middleware
- Path validation with `createSafePathBuilder` prevents traversal attacks
- File type validation (same blocklist as chat uploads)

## Frontend Implementation

### Chat UI

#### Remove @wsb/image-manager-loader

**File:** `app/package.json`

- Remove `@wsb/image-manager-loader` dependency

**File:** `app/src/app/develop/components/chat/AssetManagerModal.tsx`

- Delete entire file

#### New Component: FileUploadButton

**File:** `app/src/app/develop/components/chat/FileUploadButton.tsx`

```typescript
interface FileUploadButtonProps {
  appId: string;
  onFilesUploaded: (files: UploadedFile[]) => void;
}

export default function FileUploadButton({ appId, onFilesUploaded }: FileUploadButtonProps) {
  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    // Upload files
    const formData = new FormData();
    formData.append('appId', appId);
    files.forEach(file => formData.append('files', file));

    const result = await agentFetch(`/files/upload`, {
      method: 'POST',
      body: formData
    });

    onFilesUploaded(result.files);
  };

  return (
    <>
      <input
        type="file"
        multiple
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        ref={fileInputRef}
      />
      <Button onClick={() => fileInputRef.current?.click()}>
        <PlusIcon />
      </Button>
    </>
  );
}
```

#### Update Message Types

**File:** `app/src/types/message.ts` (or equivalent)

```typescript
interface FileAttachment {
  uploadId: string;
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string; // API URL to fetch file
}

interface Message {
  // ... existing fields
  attachments?: FileAttachment[];
}
```

#### File Preview Component

**File:** `app/src/app/develop/components/chat/FilePreview.tsx`

```typescript
interface FilePreviewProps {
  file: FileAttachment;
  onRemove?: () => void;
}

export default function FilePreview({ file, onRemove }: FilePreviewProps) {
  const isImage = file.mimeType.startsWith('image/');

  if (isImage) {
    return (
      <div className="relative inline-block">
        <img src={file.url} alt={file.filename} className="max-w-[200px] rounded" />
        {onRemove && (
          <button onClick={onRemove} className="absolute top-0 right-0">
            <XIcon />
          </button>
        )}
      </div>
    );
  }

  // Non-image file
  return (
    <div className="flex items-center gap-2 p-2 rounded bg-gray-100">
      <PageIcon />
      <span>{file.filename}</span>
      <span className="text-xs text-gray-500">{file.mimeType.split('/')[1].toUpperCase()}</span>
      {onRemove && (
        <button onClick={onRemove}>
          <XIcon />
        </button>
      )}
    </div>
  );
}
```

### Code Preview UI

#### FileTree Component Updates

**File:** `app/src/app/develop/components/FileTree.tsx`

**Add toolbar:**

```typescript
<div className="flex gap-2 p-2 border-b">
  <Button size="sm" onClick={handleNewFile}>
    <PlusIcon /> New File
  </Button>
  <Button size="sm" onClick={handleUploadFiles}>
    <UploadIcon /> Upload
  </Button>
  <Button size="sm" onClick={handleRefresh}>
    <RefreshIcon />
  </Button>
</div>
```

**Add context menu:**

```typescript
const ContextMenu = ({ item, onClose }: ContextMenuProps) => {
  if (item.type === 'folder') {
    return (
      <Menu>
        <MenuItem onClick={() => handleNewFile(item.path)}>
          New File Here
        </MenuItem>
        <MenuItem onClick={() => handleUpload(item.path)}>
          Upload Files Here
        </MenuItem>
      </Menu>
    );
  }

  // File context menu
  return (
    <Menu>
      <MenuItem onClick={() => handleDelete(item.path)}>
        Delete
      </MenuItem>
    </Menu>
  );
};
```

#### New File Modal

**File:** `app/src/app/develop/components/preview/NewFileModal.tsx`

```typescript
interface NewFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetPath: string;
  onFileCreated: (path: string) => void;
}

export default function NewFileModal({ isOpen, onClose, targetPath, onFileCreated }: NewFileModalProps) {
  const [filename, setFilename] = useState('');

  const handleCreate = async () => {
    const fullPath = path.join(targetPath, filename);

    // Call agent API to create empty file
    await agentFetch(`/apps/${appId}/files/create`, {
      method: 'POST',
      body: JSON.stringify({ path: fullPath, content: '' })
    });

    onFileCreated(fullPath);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalHeader>New File</ModalHeader>
      <ModalBody>
        <Input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="filename.ext"
        />
      </ModalBody>
      <ModalFooter>
        <Button onClick={handleCreate}>Create</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </ModalFooter>
    </Modal>
  );
}
```

#### Upload Handler

```typescript
const handleDirectUpload = async (targetPath: string, files: File[]) => {
  const formData = new FormData();
  formData.append("targetPath", targetPath);
  files.forEach((file) => formData.append("files", file));

  const result = await agentFetch(`/apps/${appId}/files/direct-upload`, {
    method: "POST",
    body: formData,
  });

  // Refresh file tree
  await loadFiles();

  return result.files;
};
```

## Error Handling

### Upload Failures

**Scenario:** Network error, server error, timeout

**Handling:**

- Show toast notification with error message
- Display "Retry" button
- Keep file in upload queue for retry

### File Too Large

**Scenario:** User selects file > 10MB

**Handling:**

- Validate file size client-side before upload
- Show error: "File '{filename}' exceeds 10MB limit (size: {actual})"
- Allow user to remove file and try different file

### Blocked File Type

**Scenario:** User uploads .exe, .zip, or other blocked type

**Handling:**

- Validate extension and MIME type before upload
- Show error: "File type '.{ext}' is not allowed for security reasons"
- Suggest alternatives if applicable (e.g., "Upload individual files instead of archives")

### Agent Auto-Move Fails

**Scenario:** File in `/tmp/uploads/` cannot be moved to target location

**Handling:**

- Log error with full context
- Agent returns error message to user
- Suggest manual upload via Code Preview to correct location

### Duplicate Filenames

**Scenario:** File with same name already exists at target location

**Chat uploads:** Auto-rename with suffix (logo.png → logo-1.png, logo-2.png, etc.)

**Code Preview uploads:** Show confirmation dialog:

- "File 'logo.png' already exists. Replace?"
- Options: Replace, Keep Both (auto-rename), Cancel

## Testing Strategy

### Unit Tests

**Backend:**

`agents/src/services/FileUploadService.test.ts`:

- File type validation (allowed and blocked types)
- Extension and MIME type checking
- File size validation
- List uploaded files across multiple upload sessions

`agents/src/tools/file-edit.test.ts`:

- Auto-resolution from `/tmp/uploads/`
- File movement from uploads to project
- Error handling when file not found
- Path security validation

`agents/src/server/routes/files.test.ts`:

- Direct upload endpoint
- Authorization with `validateAppOwnership`
- Path traversal prevention
- Error responses for blocked file types

**Frontend:**

`app/src/app/develop/components/chat/FileUploadButton.test.tsx`:

- File selection and upload
- Progress indication
- Error handling and retry
- Multiple file upload

`app/src/app/develop/components/FileTree.test.tsx`:

- Context menu rendering
- New file creation
- File upload from tree
- Delete confirmation

`app/src/app/develop/components/chat/FilePreview.test.tsx`:

- Image thumbnail rendering
- File icon rendering
- Remove button functionality
- Different file types

### Integration Tests

**Test 1: Chat upload → Agent use → File moved**

```typescript
it("should upload file via chat and agent should move to project", async () => {
  // 1. Upload image via chat
  const file = new File(["content"], "logo.png", { type: "image/png" });
  await uploadFileToChat(appId, file);

  // 2. Send message to agent
  await sendChatMessage(appId, "use that logo in the header");

  // 3. Wait for agent response
  await waitForAgentResponse();

  // 4. Verify file moved from /tmp/uploads/ to /public/assets/
  const projectFile = await readProjectFile(appId, "/public/assets/logo.png");
  expect(projectFile).toBeDefined();

  // 5. Verify file no longer in /tmp/uploads/
  const uploadFile = await checkUploadsDir(appId, "logo.png");
  expect(uploadFile).toBeNull();

  // 6. Verify code references the file
  const code = await readProjectFile(appId, "/app/layout.tsx");
  expect(code).toContain("/public/assets/logo.png");
});
```

**Test 2: Code Preview direct upload**

```typescript
it("should upload file directly to project folder", async () => {
  // 1. Upload file to /src/components/
  const file = new File(["export const Button = () => {}"], "Button.tsx", {
    type: "text/typescript",
  });
  await directUploadToProject(appId, "/src/components/", [file]);

  // 2. Verify file exists in project
  const projectFile = await readProjectFile(
    appId,
    "/src/components/Button.tsx",
  );
  expect(projectFile).toBeDefined();
  expect(projectFile.content).toContain("export const Button");

  // 3. Verify file NOT in /tmp/uploads/
  const uploadFile = await checkUploadsDir(appId, "Button.tsx");
  expect(uploadFile).toBeNull();
});
```

**Test 3: File cleanup after 24 hours**

```typescript
it("should clean up expired files from /tmp/uploads/", async () => {
  // 1. Upload files
  await uploadFileToChat(appId, file1);
  await uploadFileToChat(appId, file2);

  // 2. Mock timestamp to 24+ hours later
  jest.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);

  // 3. Run cleanup service
  await fileUploadService.deleteExpiredUploads();

  // 4. Verify files deleted
  const files = await fileUploadService.listUploadedFiles(appId);
  expect(files).toHaveLength(0);
});
```

**Test 4: Blocked file type rejection**

```typescript
it("should reject blocked file types", async () => {
  // Try to upload .exe file
  const file = new File(["content"], "virus.exe", {
    type: "application/x-msdownload",
  });

  const result = await uploadFileToChat(appId, file);

  expect(result.error).toBeDefined();
  expect(result.error).toContain("not allowed for security reasons");
});
```

### Manual Testing Checklist

- [ ] Upload various file types (images, fonts, JSON, CSV, PDF)
- [ ] Upload file near 10MB limit
- [ ] Upload blocked file type (.exe, .zip) - verify error message
- [ ] Upload image via chat, ask agent to use it, verify auto-move
- [ ] Create new file from Code Preview toolbar
- [ ] Upload files via Code Preview context menu
- [ ] Delete file from Code Preview context menu
- [ ] Upload duplicate filename - verify rename or replace flow
- [ ] Test on multiple browsers (Chrome, Firefox, Safari)
- [ ] Test file picker on different OS (Mac, Windows, Linux)
- [ ] Verify 24-hour cleanup runs correctly
- [ ] Test large uploads with slow network (progress indication)

## Migration Plan

### Phase 1: Backend Infrastructure (Week 1)

1. Update FileUploadService with blocklist validation
2. Enhance file-edit tool with auto-resolution
3. Add direct upload API endpoint
4. Write backend unit tests

### Phase 2: Chat UI (Week 1-2)

1. Remove @wsb/image-manager-loader dependency
2. Create FileUploadButton component
3. Update message types for file attachments
4. Create FilePreview component
5. Integrate with chat interface
6. Write frontend unit tests for chat

### Phase 3: Code Preview UI (Week 2)

1. Add FileTree toolbar and context menu
2. Create NewFileModal component
3. Implement direct upload handler
4. Add delete confirmation dialog
5. Write frontend unit tests for Code Preview

### Phase 4: Integration & Testing (Week 3)

1. Write integration tests
2. Manual testing across browsers/OS
3. Performance testing (large files, multiple uploads)
4. Security audit (path traversal, file type bypass attempts)

### Phase 5: Documentation & Launch (Week 3)

1. Update user documentation
2. Create demo video showing new features
3. Announcement to team
4. Monitor error logs for issues
5. Gather user feedback

## Success Metrics

**Technical:**

- Zero path traversal vulnerabilities
- 100% of blocked file types rejected
- File cleanup runs successfully on schedule
- < 2 second upload time for 1MB files
- < 500ms UI response time for file operations

**User Experience:**

- Users can upload any common file type
- Agent automatically uses uploaded files without manual instructions
- Users can create/upload/delete files from Code Preview
- Clear error messages for all failure scenarios

**Adoption:**

- 90% of users switch from old image manager to new system within 2 weeks
- Zero escalations for "can't upload [file type]" after launch

## Future Enhancements (Out of Scope)

1. **Image editing:** Crop, resize, rotate, filters (deferred)
2. **Text file editing:** Inline text editor for quick edits (deferred)
3. **Archive support:** .zip file upload and extraction (blocked for now)
4. **File preview:** View file contents without opening in editor
5. **Drag-and-drop:** Drag files from OS directly into chat or file tree
6. **Bulk operations:** Select multiple files for delete/move
7. **File history:** Track versions of uploaded files
8. **Search:** Find files by name, type, or content
