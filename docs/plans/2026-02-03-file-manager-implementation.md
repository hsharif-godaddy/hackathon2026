---
status: not-implemented
---

# File Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace @wsb/image-manager-loader with internal file management system supporting any file type with chat upload and Code Preview CRUD operations.

**Architecture:** Two upload contexts - chat uploads to `/tmp/uploads/` for LLM context with auto-move by agents, Code Preview uploads directly to project. Backend uses enhanced FileUploadService with blocklist validation and file-edit tool auto-resolution.

**Tech Stack:** Express + Multer (backend), React + UXCore (frontend), TypeScript, Jest/Vitest

---

## Phase 1: Backend - File Type Validation

### Task 1: Add file type blocklist to FileUploadService

**Files:**
- Modify: `agents/src/services/FileUploadService.ts:26-116`
- Test: `agents/src/services/__tests__/FileUploadService.test.ts` (create)

**Step 1: Write failing test for blocked file types**

```typescript
// agents/src/services/__tests__/FileUploadService.test.ts
import { FileUploadService } from '../FileUploadService.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('FileUploadService - File Type Validation', () => {
  let service: FileUploadService;

  beforeEach(() => {
    service = new FileUploadService('/tmp/test-uploads');
  });

  it('should reject executable files', () => {
    const file = {
      originalname: 'malware.exe',
      mimetype: 'application/x-msdownload',
      size: 1024,
      buffer: Buffer.from('test')
    } as Express.Multer.File;

    expect(() => service.validateFile(file)).toThrow('not allowed for security reasons');
  });

  it('should reject archive files', () => {
    const file = {
      originalname: 'archive.zip',
      mimetype: 'application/zip',
      size: 1024,
      buffer: Buffer.from('test')
    } as Express.Multer.File;

    expect(() => service.validateFile(file)).toThrow('not allowed for security reasons');
  });

  it('should accept image files', () => {
    const file = {
      originalname: 'photo.png',
      mimetype: 'image/png',
      size: 1024,
      buffer: Buffer.from('test')
    } as Express.Multer.File;

    expect(() => service.validateFile(file)).not.toThrow();
  });

  it('should accept JSON files', () => {
    const file = {
      originalname: 'data.json',
      mimetype: 'application/json',
      size: 1024,
      buffer: Buffer.from('test')
    } as Express.Multer.File;

    expect(() => service.validateFile(file)).not.toThrow();
  });

  it('should accept font files', () => {
    const file = {
      originalname: 'font.woff2',
      mimetype: 'font/woff2',
      size: 1024,
      buffer: Buffer.from('test')
    } as Express.Multer.File;

    expect(() => service.validateFile(file)).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd agents && pnpm test:unit FileUploadService.test.ts`

Expected: Tests fail with "validateFile is not a function" or similar

**Step 3: Implement blocklist validation**

```typescript
// agents/src/services/FileUploadService.ts (replace lines 26-116)

const BLOCKED_EXTENSIONS = new Set([
  // Server-side executables
  '.exe', '.dll', '.so', '.dylib',
  // Server-side scripts
  '.php', '.jsp', '.asp', '.aspx',
  // Shell scripts
  '.sh', '.bat', '.cmd', '.ps1',
  // Database files
  '.sql', '.db',
  // Archives
  '.zip', '.tar', '.gz', '.rar', '.7z'
]);

const BLOCKED_MIME_TYPES = new Set([
  'application/x-executable',
  'application/x-msdownload',
  'application/x-sh',
  'application/x-php',
  'application/zip',
  'application/x-tar',
  'application/gzip',
  'application/x-rar-compressed',
  'application/x-7z-compressed'
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 5;
const UPLOAD_EXPIRY_HOURS = 24;

export class FileUploadService {
  // ... existing constructor and methods ...

  validateFile(file: Express.Multer.File): void {
    // Check file extension
    const ext = extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      throw new Error(
        `File type '${ext}' is not allowed for security reasons. Please upload a different file type.`
      );
    }

    // Check MIME type
    if (BLOCKED_MIME_TYPES.has(file.mimetype)) {
      throw new Error(
        `File type '${file.mimetype}' is not allowed for security reasons. Please upload a different file type.`
      );
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(
        `File size ${file.size} bytes exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`
      );
    }
  }

  validateUpload(files: Express.Multer.File[]): void {
    if (files.length === 0) {
      throw new Error('No files provided');
    }

    if (files.length > MAX_FILES_PER_UPLOAD) {
      throw new Error(
        `Too many files. Maximum ${MAX_FILES_PER_UPLOAD} files allowed per upload`
      );
    }

    for (const file of files) {
      this.validateFile(file);
    }
  }

  // ... rest of existing methods unchanged ...
}
```

**Step 4: Run tests to verify they pass**

Run: `cd agents && pnpm test:unit FileUploadService.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add agents/src/services/FileUploadService.ts agents/src/services/__tests__/FileUploadService.test.ts
git commit -m "feat(agents): add file type blocklist validation to FileUploadService

- Replace image-only whitelist with blocklist approach
- Block executables, scripts, databases, archives
- Accept images, fonts, documents, data files, code files
- Add comprehensive unit tests for validation"
```

---

### Task 2: Add listUploadedFiles method

**Files:**
- Modify: `agents/src/services/FileUploadService.ts:243-380`
- Test: `agents/src/services/__tests__/FileUploadService.test.ts`

**Step 1: Write failing test**

```typescript
// Add to agents/src/services/__tests__/FileUploadService.test.ts

describe('FileUploadService - List Files', () => {
  it('should list all uploaded files across upload sessions', async () => {
    const service = new FileUploadService('/tmp/test-uploads');

    // Upload files in two separate sessions
    const files1 = [
      {
        originalname: 'file1.png',
        mimetype: 'image/png',
        size: 1024,
        buffer: Buffer.from('test1')
      } as Express.Multer.File
    ];

    const files2 = [
      {
        originalname: 'file2.json',
        mimetype: 'application/json',
        size: 512,
        buffer: Buffer.from('test2')
      } as Express.Multer.File
    ];

    const result1 = await service.processUpload('test-app', files1);
    const result2 = await service.processUpload('test-app', files2);

    const allFiles = await service.listUploadedFiles('test-app');

    expect(allFiles).toHaveLength(2);
    expect(allFiles.map(f => f.originalName)).toContain('file1.png');
    expect(allFiles.map(f => f.originalName)).toContain('file2.json');
  });

  it('should return empty array for app with no uploads', async () => {
    const service = new FileUploadService('/tmp/test-uploads');

    const files = await service.listUploadedFiles('nonexistent-app');

    expect(files).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd agents && pnpm test:unit FileUploadService.test.ts`

Expected: Test fails with "listUploadedFiles is not a function"

**Step 3: Implement listUploadedFiles**

```typescript
// Add to agents/src/services/FileUploadService.ts after getUpload method

async listUploadedFiles(appId: string): Promise<UploadedFile[]> {
  const appDir = this.pathBuilder.join(appId);

  if (!existsSync(appDir)) {
    return [];
  }

  const allFiles: UploadedFile[] = [];

  try {
    const uploadDirs = readdirSync(appDir);

    for (const uploadId of uploadDirs) {
      const metadataPath = this.pathBuilder.join(appId, uploadId, 'metadata.json');

      if (!existsSync(metadataPath)) {
        continue;
      }

      try {
        const metadataContent = await readFile(metadataPath, 'utf-8');
        const metadata = JSON.parse(metadataContent);

        if (metadata.files && Array.isArray(metadata.files)) {
          allFiles.push(...metadata.files);
        }
      } catch (error) {
        fileUploadEvents.retrieveFailure(
          logger,
          error instanceof Error ? error : new Error(String(error)),
          { appId, uploadId }
        );
      }
    }

    return allFiles;
  } catch (error) {
    fileUploadEvents.retrieveFailure(
      logger,
      error instanceof Error ? error : new Error(String(error)),
      { appId, uploadId: 'list-all' }
    );
    return [];
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd agents && pnpm test:unit FileUploadService.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add agents/src/services/FileUploadService.ts agents/src/services/__tests__/FileUploadService.test.ts
git commit -m "feat(agents): add listUploadedFiles method to FileUploadService

- List all files across all upload sessions for an app
- Handle missing metadata gracefully
- Return empty array for apps with no uploads"
```

---

## Phase 2: Backend - file-edit Tool Enhancement

### Task 3: Add file resolution to file-edit tool

**Files:**
- Modify: `agents/src/tools/file-edit.ts:18-380`
- Test: `agents/src/tools/__tests__/file-edit-resolution.test.ts` (create)

**Step 1: Write failing test for auto-resolution**

```typescript
// agents/src/tools/__tests__/file-edit-resolution.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileEditTool } from '../file-edit.js';
import { fileUploadService } from '../../services/FileUploadService.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

describe('FileEditTool - Auto Resolution', () => {
  const testAppId = 'test-app-resolution';
  const testUploadDir = `/tmp/test-uploads/${testAppId}`;
  const testProjectDir = `/tmp/test-project/${testAppId}`;

  beforeEach(async () => {
    // Clean up test directories
    if (existsSync(testUploadDir)) {
      await rm(testUploadDir, { recursive: true });
    }
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true });
    }

    await mkdir(testProjectDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    if (existsSync(testUploadDir)) {
      await rm(testUploadDir, { recursive: true });
    }
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true });
    }
  });

  it('should auto-resolve file from uploads when creating new file', async () => {
    // Upload a file
    const testFile = {
      originalname: 'logo.png',
      mimetype: 'image/png',
      size: 1024,
      buffer: Buffer.from('test-image-content')
    } as Express.Multer.File;

    await fileUploadService.processUpload(testAppId, [testFile]);

    // Try to create file in project
    const tool = new FileEditTool();
    const result = await tool.execute({
      appId: testAppId,
      path: '/public/assets/logo.png',
      mode: 'create',
      content: '' // Empty content, should auto-resolve
    });

    expect(result.success).toBe(true);

    // Verify file was copied to project
    const projectFilePath = path.join(testProjectDir, 'public/assets/logo.png');
    expect(existsSync(projectFilePath)).toBe(true);

    // Verify content matches uploaded file
    const content = await readFile(projectFilePath, 'utf-8');
    expect(content).toBe('test-image-content');
  });

  it('should not auto-resolve if file already exists in project', async () => {
    // Create existing file in project
    const projectFilePath = path.join(testProjectDir, 'public/assets/existing.png');
    await mkdir(path.dirname(projectFilePath), { recursive: true });
    await writeFile(projectFilePath, 'existing-content');

    // Upload different file with same name
    const testFile = {
      originalname: 'existing.png',
      mimetype: 'image/png',
      size: 1024,
      buffer: Buffer.from('new-content')
    } as Express.Multer.File;

    await fileUploadService.processUpload(testAppId, [testFile]);

    // Try to edit file - should use project file, not upload
    const tool = new FileEditTool();
    const result = await tool.execute({
      appId: testAppId,
      path: '/public/assets/existing.png',
      mode: 'edit',
      edits: [{ old: 'existing', new: 'updated' }]
    });

    expect(result.success).toBe(true);

    // Verify original project file was edited, not replaced with upload
    const content = await readFile(projectFilePath, 'utf-8');
    expect(content).toBe('updated-content');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd agents && pnpm test:unit file-edit-resolution.test.ts`

Expected: Tests fail

**Step 3: Implement auto-resolution in file-edit tool**

```typescript
// Add to agents/src/tools/file-edit.ts after imports

import { fileUploadService } from '../services/FileUploadService.js';
import { basename } from 'path';

// Add new method to FileEditTool class
private async resolveSourceFile(
  appId: string,
  targetPath: string,
  appBasePath: string
): Promise<boolean> {
  const filename = basename(targetPath);
  const fullTargetPath = path.join(appBasePath, targetPath);

  // Check if file already exists in project
  if (existsSync(fullTargetPath)) {
    return false; // Don't auto-resolve, use existing project file
  }

  // List all uploaded files for this app
  const uploadedFiles = await fileUploadService.listUploadedFiles(appId);

  // Find matching file by name
  const matchingFile = uploadedFiles.find(f => f.filename === filename || f.originalName === filename);

  if (!matchingFile) {
    return false; // No matching upload found
  }

  // Get the full path to the uploaded file
  const sourcePath = fileUploadService.getFilePath(appId, matchingFile.uploadId, matchingFile.filename);

  if (!existsSync(sourcePath)) {
    logger.warn('file-edit.auto-resolve.source-missing', {
      appId,
      filename,
      sourcePath
    });
    return false;
  }

  // Ensure target directory exists
  await mkdir(path.dirname(fullTargetPath), { recursive: true });

  // Copy file from uploads to project
  const sourceContent = await readFile(sourcePath);
  await writeFile(fullTargetPath, sourceContent);

  logger.info('file-edit.auto-resolved', {
    appId,
    filename,
    from: sourcePath,
    to: fullTargetPath
  });

  return true;
}

// Modify editFile method to use auto-resolution
async editFile(options: FileEditOptions): Promise<FileEditResult> {
  const {
    path: filePath,
    mode = 'edit',
    // ... other options
  } = options;

  // Get app info
  const app = this.appRepository.findById(options.appId);
  if (!app) {
    throw new Error(`App not found: ${options.appId}`);
  }

  const appBasePath = app.path;
  const fullPath = path.join(appBasePath, filePath);

  // Try auto-resolution for create/rewrite modes
  if (mode === 'create' || mode === 'rewrite') {
    const resolved = await this.resolveSourceFile(options.appId, filePath, appBasePath);

    if (resolved) {
      // File was auto-resolved, return success
      return {
        success: true,
        path: filePath,
        mode: mode,
        changes: {
          additions: 1,
          deletions: 0,
          totalLines: 1
        }
      };
    }
  }

  // Continue with normal file-edit logic...
  // ... existing implementation ...
}
```

**Step 4: Run tests to verify they pass**

Run: `cd agents && pnpm test:unit file-edit-resolution.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add agents/src/tools/file-edit.ts agents/src/tools/__tests__/file-edit-resolution.test.ts
git commit -m "feat(agents): add auto-resolution from uploads to file-edit tool

- Check /tmp/uploads/ for matching filename when creating/rewriting files
- Automatically copy from uploads to project on first use
- Prefer existing project files over uploads
- Log auto-resolution for debugging"
```

---

## Phase 3: Backend - Direct Upload API

### Task 4: Add direct upload route

**Files:**
- Modify: `agents/src/server/routes/files.ts:206-208`
- Test: `agents/src/server/routes/__tests__/files-direct-upload.test.ts` (create)

**Step 1: Write failing integration test**

```typescript
// agents/src/server/routes/__tests__/files-direct-upload.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { filesRouter } from '../files.js';

describe('POST /apps/:appId/files/direct-upload', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/files', filesRouter);
  });

  it('should upload files directly to project directory', async () => {
    const response = await request(app)
      .post('/apps/test-app/files/direct-upload')
      .set('Authorization', 'Bearer valid-token')
      .field('targetPath', '/src/components')
      .attach('files', Buffer.from('test content'), 'Button.tsx')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.files).toHaveLength(1);
    expect(response.body.files[0].name).toBe('Button.tsx');
    expect(response.body.files[0].path).toBe('/src/components/Button.tsx');
  });

  it('should reject upload without targetPath', async () => {
    const response = await request(app)
      .post('/apps/test-app/files/direct-upload')
      .set('Authorization', 'Bearer valid-token')
      .attach('files', Buffer.from('test'), 'file.txt')
      .expect(400);

    expect(response.body.error).toContain('targetPath is required');
  });

  it('should reject blocked file types', async () => {
    const response = await request(app)
      .post('/apps/test-app/files/direct-upload')
      .set('Authorization', 'Bearer valid-token')
      .field('targetPath', '/src')
      .attach('files', Buffer.from('malware'), 'virus.exe')
      .expect(400);

    expect(response.body.error).toContain('not allowed for security reasons');
  });

  it('should validate app ownership', async () => {
    const response = await request(app)
      .post('/apps/different-app/files/direct-upload')
      .set('Authorization', 'Bearer token-for-test-app')
      .field('targetPath', '/src')
      .attach('files', Buffer.from('test'), 'file.txt')
      .expect(403);

    expect(response.body.error).toBe('Access denied');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd agents && pnpm test:integration files-direct-upload.test.ts`

Expected: Tests fail with 404 (route not found)

**Step 3: Implement direct upload route**

```typescript
// Add to agents/src/server/routes/files.ts before export

router.post('/apps/:appId/files/direct-upload',
  validateAppIdParam,
  upload.array('files', 5),
  async (req: Request, res: Response) => {
    try {
      const { appId } = req.params;
      const { targetPath } = req.body;

      if (!targetPath || typeof targetPath !== 'string') {
        return res.status(400).json({
          error: 'targetPath is required in request body'
        });
      }

      const contextLogger = log.forApp(appId);
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        return res.status(400).json({
          error: 'No files provided'
        });
      }

      // Validate file types
      try {
        fileUploadService.validateUpload(files);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return res.status(400).json({ error: errorMessage });
      }

      // Get app base path
      const appRepository = new AppRepository();
      const app = appRepository.findById(appId);

      if (!app) {
        return res.status(404).json({ error: 'App not found' });
      }

      const appBasePath = app.path;
      const pathBuilder = createSafePathBuilder(appBasePath);
      const safePath = pathBuilder.join(targetPath);

      // Ensure target directory exists
      await mkdir(safePath, { recursive: true });

      // Write files
      const createdFiles = [];
      for (const file of files) {
        const filePath = pathBuilder.join(targetPath, file.originalname);
        await writeFile(filePath, file.buffer);

        createdFiles.push({
          name: file.originalname,
          path: path.relative(appBasePath, filePath),
          size: file.size
        });

        contextLogger.info('file-upload.direct.success', {
          filename: file.originalname,
          targetPath,
          size: file.size
        });
      }

      return res.status(200).json({
        success: true,
        files: createdFiles
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('file-upload.direct.failed', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });

      return res.status(500).json({
        error: 'Internal server error'
      });
    }
  }
);
```

**Step 4: Add imports needed**

```typescript
// Add to top of agents/src/server/routes/files.ts
import { mkdir, writeFile } from 'fs/promises';
import { createSafePathBuilder } from '../../utils/safe-path.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import path from 'path';
```

**Step 5: Run tests to verify they pass**

Run: `cd agents && pnpm test:integration files-direct-upload.test.ts`

Expected: All tests pass

**Step 6: Commit**

```bash
git add agents/src/server/routes/files.ts agents/src/server/routes/__tests__/files-direct-upload.test.ts
git commit -m "feat(agents): add direct upload API endpoint

- POST /apps/:appId/files/direct-upload for Code Preview uploads
- Upload files directly to specified project directory
- Validate file types with blocklist
- Protected by validateAppIdParam middleware
- Prevent path traversal with createSafePathBuilder"
```

---

## Phase 4: Frontend - Remove Old Asset Manager

### Task 5: Remove @wsb/image-manager-loader

**Files:**
- Delete: `app/src/app/develop/components/chat/AssetManagerModal.tsx`
- Modify: `app/package.json`
- Modify: `app/next.config.js` (remove webpack config if any)

**Step 1: Check for AssetManagerModal usage**

Run: `cd app && grep -r "AssetManagerModal" src/`

Expected: See all files importing/using AssetManagerModal

**Step 2: Remove import from chat component**

Find where AssetManagerModal is imported (likely in chat interface component) and comment out for now:

```typescript
// import AssetManagerModal from '@/app/develop/components/chat/AssetManagerModal'
```

**Step 3: Remove dependency from package.json**

```bash
cd app && pnpm remove @wsb/image-manager-loader
```

**Step 4: Delete AssetManagerModal file**

```bash
rm app/src/app/develop/components/chat/AssetManagerModal.tsx
```

**Step 5: Verify build still works**

Run: `cd app && pnpm typecheck`

Expected: No errors (may have unused import warnings)

**Step 6: Commit**

```bash
git add app/package.json app/pnpm-lock.yaml app/src/app/develop/components/chat/AssetManagerModal.tsx
git commit -m "refactor(app): remove @wsb/image-manager-loader dependency

- Delete AssetManagerModal component
- Remove @wsb/image-manager-loader from package.json
- Prepare for new internal file upload system"
```

---

## Phase 5: Frontend - Chat File Upload

### Task 6: Create FileUploadButton component

**Files:**
- Create: `app/src/app/develop/components/chat/FileUploadButton.tsx`
- Test: `app/src/app/develop/components/chat/__tests__/FileUploadButton.test.tsx` (create)

**Step 1: Write failing test**

```typescript
// app/src/app/develop/components/chat/__tests__/FileUploadButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FileUploadButton from '../FileUploadButton';
import { agentFetch } from '@/lib/agent-fetch';

vi.mock('@/lib/agent-fetch');

describe('FileUploadButton', () => {
  it('should render upload button', () => {
    render(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('should open file picker when clicked', () => {
    render(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} />);

    const button = screen.getByRole('button');
    const fileInput = screen.getByTestId('file-input');

    const clickSpy = vi.spyOn(fileInput, 'click');

    fireEvent.click(button);

    expect(clickSpy).toHaveBeenCalled();
  });

  it('should upload selected files', async () => {
    const mockOnFilesUploaded = vi.fn();
    const mockResponse = {
      uploadId: 'upload_123',
      files: [
        { id: 'file_1', filename: 'test.png', originalName: 'test.png' }
      ]
    };

    vi.mocked(agentFetch).mockResolvedValue(mockResponse);

    render(<FileUploadButton appId="test-app" onFilesUploaded={mockOnFilesUploaded} />);

    const fileInput = screen.getByTestId('file-input');
    const file = new File(['content'], 'test.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(agentFetch).toHaveBeenCalledWith('/files/upload', expect.objectContaining({
        method: 'POST'
      }));
    });

    expect(mockOnFilesUploaded).toHaveBeenCalledWith(mockResponse.files);
  });

  it('should handle upload errors', async () => {
    vi.mocked(agentFetch).mockRejectedValue(new Error('Upload failed'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} />);

    const fileInput = screen.getByTestId('file-input');
    const file = new File(['content'], 'test.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd app && pnpm test FileUploadButton.test.tsx`

Expected: Tests fail (component doesn't exist)

**Step 3: Create FileUploadButton component**

```typescript
// app/src/app/develop/components/chat/FileUploadButton.tsx
'use client'

import { useRef, ChangeEvent } from 'react';
import Button from '@ux/button';
import PlusIcon from '@ux/icon/plus';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';

export interface UploadedFile {
  id: string;
  originalName: string;
  filename: string;
  size: number;
  mimeType: string | null;
  uploadedAt: string;
}

interface FileUploadButtonProps {
  appId: string;
  onFilesUploaded: (files: UploadedFile[]) => void;
  disabled?: boolean;
}

export default function FileUploadButton({
  appId,
  onFilesUploaded,
  disabled = false
}: FileUploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    if (files.length === 0) {
      return;
    }

    try {
      logger.debug('file-upload.chat.start', {
        appId,
        fileCount: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0)
      });

      const formData = new FormData();
      formData.append('appId', appId);
      files.forEach(file => formData.append('files', file));

      const result = await agentFetch('/files/upload', {
        method: 'POST',
        body: formData
      });

      logger.info('file-upload.chat.success', {
        appId,
        uploadId: result.uploadId,
        fileCount: result.files.length
      });

      onFilesUploaded(result.files);

      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      logger.error('file-upload.chat.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });

      console.error('File upload failed:', error);
      // TODO: Show error toast notification
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        data-testid="file-input"
        accept="image/*,video/*,.pdf,.json,.xml,.yaml,.yml,.txt,.md,.csv,.ttf,.otf,.woff,.woff2,.mp3,.wav,.js,.ts,.jsx,.tsx,.css,.html"
      />
      <Button
        onClick={handleButtonClick}
        disabled={disabled}
        variant="tertiary"
        size="sm"
      >
        <PlusIcon />
      </Button>
    </>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `cd app && pnpm test FileUploadButton.test.tsx`

Expected: All tests pass

**Step 5: Commit**

```bash
git add app/src/app/develop/components/chat/FileUploadButton.tsx app/src/app/develop/components/chat/__tests__/FileUploadButton.test.tsx
git commit -m "feat(app): add FileUploadButton component for chat uploads

- Button with file picker for multiple file selection
- Upload to /files/upload endpoint
- Accept images, documents, fonts, data files, code files
- Handle errors with logging
- Reset input after upload"
```

---

### Task 7: Create FilePreview component

**Files:**
- Create: `app/src/app/develop/components/chat/FilePreview.tsx`
- Test: `app/src/app/develop/components/chat/__tests__/FilePreview.test.tsx` (create)

**Step 1: Write failing test**

```typescript
// app/src/app/develop/components/chat/__tests__/FilePreview.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilePreview from '../FilePreview';

describe('FilePreview', () => {
  it('should render image thumbnail', () => {
    const file = {
      uploadId: 'upload_123',
      fileId: 'file_1',
      filename: 'photo.png',
      mimeType: 'image/png',
      size: 1024,
      url: '/api/files/test-app/upload_123/photo.png'
    };

    render(<FilePreview file={file} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', file.url);
    expect(img).toHaveAttribute('alt', file.filename);
  });

  it('should render file icon for non-images', () => {
    const file = {
      uploadId: 'upload_123',
      fileId: 'file_1',
      filename: 'data.json',
      mimeType: 'application/json',
      size: 512,
      url: '/api/files/test-app/upload_123/data.json'
    };

    render(<FilePreview file={file} />);

    expect(screen.getByText('data.json')).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
  });

  it('should call onRemove when remove button clicked', () => {
    const mockOnRemove = vi.fn();
    const file = {
      uploadId: 'upload_123',
      fileId: 'file_1',
      filename: 'test.png',
      mimeType: 'image/png',
      size: 1024,
      url: '/api/files/test-app/upload_123/test.png'
    };

    render(<FilePreview file={file} onRemove={mockOnRemove} />);

    const removeButton = screen.getByRole('button');
    fireEvent.click(removeButton);

    expect(mockOnRemove).toHaveBeenCalled();
  });

  it('should not render remove button when onRemove not provided', () => {
    const file = {
      uploadId: 'upload_123',
      fileId: 'file_1',
      filename: 'test.png',
      mimeType: 'image/png',
      size: 1024,
      url: '/api/files/test-app/upload_123/test.png'
    };

    render(<FilePreview file={file} />);

    const buttons = screen.queryAllByRole('button');
    expect(buttons).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd app && pnpm test FilePreview.test.tsx`

Expected: Tests fail (component doesn't exist)

**Step 3: Create FilePreview component**

```typescript
// app/src/app/develop/components/chat/FilePreview.tsx
'use client'

import clsx from 'clsx';
import Button from '@ux/button';
import PageIcon from '@ux/icon/page';
import XIcon from '@ux/icon/x';

export interface FileAttachment {
  uploadId: string;
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

interface FilePreviewProps {
  file: FileAttachment;
  onRemove?: () => void;
}

export default function FilePreview({ file, onRemove }: FilePreviewProps) {
  const isImage = file.mimeType.startsWith('image/');
  const extension = file.mimeType.split('/')[1]?.toUpperCase() || 'FILE';

  if (isImage) {
    return (
      <div className="relative inline-block">
        <img
          src={file.url}
          alt={file.filename}
          className="max-w-[200px] max-h-[200px] rounded-md object-cover"
        />
        {onRemove && (
          <button
            onClick={onRemove}
            className="absolute top-1 right-1 p-1 bg-neutral-950 rounded-full hover:bg-neutral-800 transition-colors"
            aria-label="Remove file"
          >
            <XIcon className="w-4 h-4 text-neutral-50" />
          </button>
        )}
      </div>
    );
  }

  // Non-image file
  return (
    <div className={clsx(
      "flex items-center gap-2 px-3 py-2 rounded-md",
      "bg-intents-ux-box-backgroundColor border border-intents-ux-box-borderColor"
    )}>
      <PageIcon className="w-4 h-4" />
      <span className="text-sm font-medium truncate max-w-[150px]">
        {file.filename}
      </span>
      <span className="text-xs px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-700">
        {extension}
      </span>
      {onRemove && (
        <Button
          onClick={onRemove}
          variant="tertiary"
          size="sm"
          aria-label="Remove file"
        >
          <XIcon className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `cd app && pnpm test FilePreview.test.tsx`

Expected: All tests pass

**Step 5: Commit**

```bash
git add app/src/app/develop/components/chat/FilePreview.tsx app/src/app/develop/components/chat/__tests__/FilePreview.test.tsx
git commit -m "feat(app): add FilePreview component for uploaded files

- Image preview with thumbnail
- File icon with filename and extension badge for non-images
- Optional remove button
- Responsive sizing with max dimensions"
```

---

## Phase 6: Frontend - Code Preview File Operations

### Task 8: Add FileTree toolbar

**Files:**
- Modify: `app/src/app/develop/components/FileTree.tsx:1-109`
- Test: `app/src/app/develop/components/__tests__/FileTree.test.tsx` (create)

**Step 1: Write failing test**

```typescript
// app/src/app/develop/components/__tests__/FileTree.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FileTree from '../FileTree';

describe('FileTree Toolbar', () => {
  const mockFiles = [
    { name: 'src', type: 'folder' as const, path: '/src', children: [] }
  ];

  it('should render toolbar with action buttons', () => {
    render(
      <FileTree
        files={mockFiles}
        onFileSelect={() => {}}
        onNewFile={() => {}}
        onUpload={() => {}}
        onRefresh={() => {}}
      />
    );

    expect(screen.getByText(/New File/i)).toBeInTheDocument();
    expect(screen.getByText(/Upload/i)).toBeInTheDocument();
    expect(screen.getByText(/Refresh/i)).toBeInTheDocument();
  });

  it('should call onNewFile when New File clicked', () => {
    const mockOnNewFile = vi.fn();

    render(
      <FileTree
        files={mockFiles}
        onFileSelect={() => {}}
        onNewFile={mockOnNewFile}
        onUpload={() => {}}
        onRefresh={() => {}}
      />
    );

    const newFileButton = screen.getByText(/New File/i);
    fireEvent.click(newFileButton);

    expect(mockOnNewFile).toHaveBeenCalled();
  });

  it('should call onUpload when Upload clicked', () => {
    const mockOnUpload = vi.fn();

    render(
      <FileTree
        files={mockFiles}
        onFileSelect={() => {}}
        onNewFile={() => {}}
        onUpload={mockOnUpload}
        onRefresh={() => {}}
      />
    );

    const uploadButton = screen.getByText(/Upload/i);
    fireEvent.click(uploadButton);

    expect(mockOnUpload).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd app && pnpm test FileTree.test.tsx`

Expected: Tests fail (props don't exist)

**Step 3: Add toolbar to FileTree component**

```typescript
// Modify app/src/app/develop/components/FileTree.tsx

import PlusIcon from '@ux/icon/plus';
import UploadIcon from '@ux/icon/upload';
import RefreshIcon from '@ux/icon/refresh';
import Button from '@ux/button';

interface FileTreeProps {
  files: FileItem[];
  selectedFile?: string | null;
  onFileSelect: (path: string) => void;
  onNewFile?: () => void;
  onUpload?: () => void;
  onRefresh?: () => void;
}

export default function FileTree({
  files,
  selectedFile,
  onFileSelect,
  onNewFile,
  onUpload,
  onRefresh
}: FileTreeProps) {
  // ... existing state and methods ...

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      {(onNewFile || onUpload || onRefresh) && (
        <div className="flex gap-2 p-2 border-b border-intents-ux-box-borderColor">
          {onNewFile && (
            <Button
              size="sm"
              variant="tertiary"
              onClick={onNewFile}
            >
              <PlusIcon className="w-3 h-3 mr-1" />
              New File
            </Button>
          )}
          {onUpload && (
            <Button
              size="sm"
              variant="tertiary"
              onClick={onUpload}
            >
              <UploadIcon className="w-3 h-3 mr-1" />
              Upload
            </Button>
          )}
          {onRefresh && (
            <Button
              size="sm"
              variant="tertiary"
              onClick={onRefresh}
            >
              <RefreshIcon className="w-3 h-3" />
            </Button>
          )}
        </div>
      )}

      {/* Existing file tree */}
      <div className="flex-1 overflow-auto">
        <div className="py-1">
          {sortFileItems(files).map(file => renderFileItem(file))}
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `cd app && pnpm test FileTree.test.tsx`

Expected: All tests pass

**Step 5: Commit**

```bash
git add app/src/app/develop/components/FileTree.tsx app/src/app/develop/components/__tests__/FileTree.test.tsx
git commit -m "feat(app): add toolbar to FileTree with New File, Upload, and Refresh buttons

- Optional toolbar with action callbacks
- UXCore Button components with icons
- Flex layout for toolbar and tree
- Conditional rendering based on provided callbacks"
```

---

### Task 9: Create NewFileModal component

**Files:**
- Create: `app/src/app/develop/components/preview/NewFileModal.tsx`
- Test: `app/src/app/develop/components/preview/__tests__/NewFileModal.test.tsx` (create)

**Step 1: Write failing test**

```typescript
// app/src/app/develop/components/preview/__tests__/NewFileModal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewFileModal from '../NewFileModal';

describe('NewFileModal', () => {
  it('should render when open', () => {
    render(
      <NewFileModal
        isOpen={true}
        onClose={() => {}}
        targetPath="/src"
        onFileCreated={() => {}}
      />
    );

    expect(screen.getByText('New File')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/filename/i)).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    render(
      <NewFileModal
        isOpen={false}
        onClose={() => {}}
        targetPath="/src"
        onFileCreated={() => {}}
      />
    );

    expect(screen.queryByText('New File')).not.toBeInTheDocument();
  });

  it('should call onFileCreated with filename', async () => {
    const mockOnFileCreated = vi.fn();

    render(
      <NewFileModal
        isOpen={true}
        onClose={() => {}}
        targetPath="/src/components"
        onFileCreated={mockOnFileCreated}
      />
    );

    const input = screen.getByPlaceholderText(/filename/i);
    fireEvent.change(input, { target: { value: 'Button.tsx' } });

    const createButton = screen.getByText('Create');
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(mockOnFileCreated).toHaveBeenCalledWith('/src/components/Button.tsx');
    });
  });

  it('should call onClose when Cancel clicked', () => {
    const mockOnClose = vi.fn();

    render(
      <NewFileModal
        isOpen={true}
        onClose={mockOnClose}
        targetPath="/src"
        onFileCreated={() => {}}
      />
    );

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should disable Create button when filename is empty', () => {
    render(
      <NewFileModal
        isOpen={true}
        onClose={() => {}}
        targetPath="/src"
        onFileCreated={() => {}}
      />
    );

    const createButton = screen.getByText('Create');
    expect(createButton).toBeDisabled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd app && pnpm test NewFileModal.test.tsx`

Expected: Tests fail (component doesn't exist)

**Step 3: Create NewFileModal component**

```typescript
// app/src/app/develop/components/preview/NewFileModal.tsx
'use client'

import { useState } from 'react';
import Modal from '@ux/modal';
import ModalHeader from '@ux/modal-header';
import ModalBody from '@ux/modal-body';
import ModalFooter from '@ux/modal-footer';
import Input from '@ux/input';
import Button from '@ux/button';
import path from 'path-browserify';

interface NewFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetPath: string;
  onFileCreated: (fullPath: string) => void;
}

export default function NewFileModal({
  isOpen,
  onClose,
  targetPath,
  onFileCreated
}: NewFileModalProps) {
  const [filename, setFilename] = useState('');

  const handleCreate = () => {
    if (!filename.trim()) {
      return;
    }

    const fullPath = path.join(targetPath, filename.trim());
    onFileCreated(fullPath);

    // Reset and close
    setFilename('');
    onClose();
  };

  const handleClose = () => {
    setFilename('');
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalHeader>New File</ModalHeader>
      <ModalBody>
        <div className="space-y-2">
          <label htmlFor="filename" className="text-sm font-medium">
            Filename
          </label>
          <Input
            id="filename"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="filename.ext"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filename.trim()) {
                handleCreate();
              }
            }}
            autoFocus
          />
          <p className="text-xs text-neutral-600">
            Location: {targetPath}
          </p>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button
          onClick={handleCreate}
          disabled={!filename.trim()}
        >
          Create
        </Button>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
```

**Step 4: Add path-browserify dependency**

```bash
cd app && pnpm add path-browserify
cd app && pnpm add -D @types/node
```

**Step 5: Run tests to verify they pass**

Run: `cd app && pnpm test NewFileModal.test.tsx`

Expected: All tests pass

**Step 6: Commit**

```bash
git add app/src/app/develop/components/preview/NewFileModal.tsx app/src/app/develop/components/preview/__tests__/NewFileModal.test.tsx app/package.json
git commit -m "feat(app): add NewFileModal for creating files from Code Preview

- Modal with filename input
- Shows target directory path
- Validates filename not empty
- Supports Enter key to create
- Uses UXCore Modal components"
```

---

## Phase 7: Integration

### Task 10: Wire up FileTree actions in PreviewCode

**Files:**
- Modify: `app/src/app/develop/components/preview/PreviewCode.tsx:100-250`

**Step 1: Add state for modals and file upload**

```typescript
// Add to PreviewCode component state (around line 110)
const [showNewFileModal, setShowNewFileModal] = useState(false);
const [newFileTargetPath, setNewFileTargetPath] = useState('/');
const fileUploadInputRef = useRef<HTMLInputElement>(null);
```

**Step 2: Add handler functions**

```typescript
// Add handlers before loadFiles function

const handleNewFile = () => {
  // Default to root if no active file
  const targetPath = activeFile ? path.dirname(activeFile) : '/';
  setNewFileTargetPath(targetPath);
  setShowNewFileModal(true);
};

const handleFileCreated = async (filePath: string) => {
  try {
    // Create empty file via agent API
    await agentFetch(`/apps/${appId}/files/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: '' })
    });

    // Refresh file tree
    await loadFiles();

    // Open the new file
    handleFileSelect(filePath);
  } catch (error) {
    logger.error('file.create.failed', {
      appId,
      filePath,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

const handleUpload = () => {
  fileUploadInputRef.current?.click();
};

const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(event.target.files || []);

  if (files.length === 0) {
    return;
  }

  try {
    const targetPath = activeFile ? path.dirname(activeFile) : '/';

    const formData = new FormData();
    formData.append('targetPath', targetPath);
    files.forEach(file => formData.append('files', file));

    await agentFetch(`/apps/${appId}/files/direct-upload`, {
      method: 'POST',
      body: formData
    });

    // Refresh file tree
    await loadFiles();

    // Reset input
    if (fileUploadInputRef.current) {
      fileUploadInputRef.current.value = '';
    }
  } catch (error) {
    logger.error('file.upload.failed', {
      appId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
```

**Step 3: Update FileTree component usage**

```typescript
// Update FileTree render (around line 400)
<FileTree
  files={files}
  selectedFile={activeFile}
  onFileSelect={handleFileSelect}
  onNewFile={handleNewFile}
  onUpload={handleUpload}
  onRefresh={loadFiles}
/>
```

**Step 4: Add hidden file input and modal**

```typescript
// Add before closing component tag (around line 500)

{/* Hidden file input for upload */}
<input
  ref={fileUploadInputRef}
  type="file"
  multiple
  onChange={handleFilesSelected}
  style={{ display: 'none' }}
  accept="image/*,video/*,.pdf,.json,.xml,.yaml,.yml,.txt,.md,.csv,.ttf,.otf,.woff,.woff2,.mp3,.wav,.js,.ts,.jsx,.tsx,.css,.html"
/>

{/* New File Modal */}
<NewFileModal
  isOpen={showNewFileModal}
  onClose={() => setShowNewFileModal(false)}
  targetPath={newFileTargetPath}
  onFileCreated={handleFileCreated}
/>
```

**Step 5: Add imports**

```typescript
// Add to imports at top of file
import { useRef, useState, ChangeEvent } from 'react';
import NewFileModal from './NewFileModal';
import path from 'path-browserify';
```

**Step 6: Test manually**

Run: `cd app && pnpm dev`

Manual testing:
1. Navigate to Code Preview
2. Click "New File" - modal should open
3. Enter filename and create
4. Click "Upload" - file picker should open
5. Select files and upload

Expected: Files appear in tree, no errors

**Step 7: Commit**

```bash
git add app/src/app/develop/components/preview/PreviewCode.tsx
git commit -m "feat(app): wire up file operations in Code Preview

- Connect FileTree toolbar to handlers
- Add New File modal integration
- Add direct file upload with hidden input
- Create empty files via agent API
- Upload files directly to current directory
- Refresh file tree after operations"
```

---

## Phase 8: Testing and Polish

### Task 11: Add end-to-end test for chat upload → agent use

**Files:**
- Create: `e2e/tests/file-manager.spec.ts`

**Step 1: Write E2E test**

```typescript
// e2e/tests/file-manager.spec.ts
import { test, expect } from '@playwright/test';

test.describe('File Manager', () => {
  test('should upload file via chat and agent uses it', async ({ page }) => {
    // Navigate to develop page
    await page.goto('/develop/test-app');

    // Wait for page to load
    await page.waitForSelector('[data-testid="chat-input"]');

    // Upload file via chat
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake-image-content')
    });

    // Wait for file preview to appear
    await expect(page.locator('img[alt="logo.png"]')).toBeVisible();

    // Send message to agent
    await page.fill('[data-testid="chat-input"]', 'add this logo to the header');
    await page.click('[data-testid="send-button"]');

    // Wait for agent response
    await page.waitForSelector('[data-testid="agent-message"]', { timeout: 30000 });

    // Verify file appears in Code Preview
    await page.click('[data-testid="code-tab"]');
    await expect(page.locator('text=/public\\/assets\\/logo\\.png/')).toBeVisible();
  });

  test('should create new file from Code Preview', async ({ page }) => {
    await page.goto('/develop/test-app');

    // Switch to Code Preview
    await page.click('[data-testid="code-tab"]');

    // Click New File button
    await page.click('text=New File');

    // Fill in filename
    await page.fill('input[placeholder="filename.ext"]', 'utils.ts');
    await page.click('text=Create');

    // Wait for file to appear in tree
    await expect(page.locator('text=utils.ts')).toBeVisible();
  });

  test('should upload files directly from Code Preview', async ({ page }) => {
    await page.goto('/develop/test-app');

    // Switch to Code Preview
    await page.click('[data-testid="code-tab"]');

    // Navigate to a folder
    await page.click('text=src');

    // Click Upload button
    await page.click('text=Upload');

    // Select file
    const fileInput = await page.locator('input[type="file"][data-testid="code-upload"]');
    await fileInput.setInputFiles({
      name: 'Component.tsx',
      mimeType: 'text/typescript',
      buffer: Buffer.from('export const Component = () => {}')
    });

    // Wait for file to appear in tree
    await expect(page.locator('text=Component.tsx')).toBeVisible();
  });
});
```

**Step 2: Run E2E tests**

Run: `pnpm test:e2e file-manager.spec.ts`

Expected: Tests pass (may need to adjust selectors)

**Step 3: Commit**

```bash
git add e2e/tests/file-manager.spec.ts
git commit -m "test(e2e): add end-to-end tests for file manager

- Test chat upload → agent usage flow
- Test Code Preview new file creation
- Test Code Preview direct file upload
- Verify file operations complete successfully"
```

---

### Task 12: Update documentation

**Files:**
- Create: `docs/features/file-manager.md`

**Step 1: Write user documentation**

```markdown
# File Manager

Upload and manage files in your Airo Builder projects.

## Features

### Chat File Upload

Upload files directly in chat for the AI agent to use:

1. Click the **+** button next to the chat input
2. Select one or more files (max 5 files, 10MB each)
3. Files appear as previews in the chat
4. Tell the agent how to use them (e.g., "add this logo to the header")
5. Agent automatically adds files to your project when referenced

**Supported file types:**
- Images: JPG, PNG, GIF, WebP, SVG, ICO
- Documents: PDF, TXT, MD, CSV
- Fonts: TTF, OTF, WOFF, WOFF2
- Media: MP4, WebM, MP3, WAV
- Data: JSON, XML, YAML, YML
- Code: JS, TS, JSX, TSX, CSS, HTML

**Temporary storage:**
- Uploaded files are stored temporarily for 24 hours
- Files are automatically moved to your project when the agent uses them
- Unused files are cleaned up after 24 hours

### Code Preview File Operations

Manage files directly in the Code Preview:

**Create New File:**
1. Click **New File** in the toolbar
2. Enter the filename
3. File is created in the current directory

**Upload Files:**
1. Navigate to a folder in the file tree
2. Click **Upload** in the toolbar
3. Select files to upload
4. Files are added directly to that directory

**Context Menu:**
- Right-click any folder to create or upload files in that location

## Limitations

**Blocked file types** (for security):
- Executables: .exe, .dll, .so
- Shell scripts: .sh, .bat, .cmd
- Archives: .zip, .tar, .gz
- Server scripts: .php, .jsp, .asp

**File size limits:**
- Maximum 10MB per file
- Maximum 5 files per upload

## Tips

- Upload mockups or screenshots in chat for design references
- Upload data files (JSON, CSV) for the agent to populate your app
- Upload custom fonts to be used in your design
- Use Code Preview upload for files that need to go to specific locations
```

**Step 2: Commit**

```bash
git add docs/features/file-manager.md
git commit -m "docs: add file manager user documentation

- Explain chat upload workflow
- Explain Code Preview file operations
- List supported and blocked file types
- Document limitations and tips"
```

---

## Final Steps

### Task 13: Build and verify

**Step 1: Run all type checks**

```bash
pnpm typecheck
```

Expected: No errors

**Step 2: Run all tests**

```bash
pnpm test
```

Expected: All tests pass

**Step 3: Run build**

```bash
pnpm build
```

Expected: Build succeeds

**Step 4: Manual smoke test**

Run: `pnpm dev`

Manual testing checklist:
- [ ] Chat file upload works
- [ ] File previews display correctly
- [ ] Agent can use uploaded files
- [ ] Code Preview new file works
- [ ] Code Preview upload works
- [ ] Blocked file types show error
- [ ] File size limit enforced

**Step 5: Final commit**

```bash
git add .
git commit -m "chore: file manager implementation complete

- Replace @wsb/image-manager-loader with internal system
- Support any file type with security blocklist
- Chat uploads for LLM context with auto-move
- Code Preview CRUD operations
- Comprehensive test coverage
- User documentation

Closes AIROBUILD-739"
```

---

## Summary

**Total tasks:** 13
**Estimated time:** 2-3 days
**Key deliverables:**
- ✅ FileUploadService with blocklist validation
- ✅ file-edit tool auto-resolution
- ✅ Direct upload API endpoint
- ✅ Chat file upload UI
- ✅ Code Preview file operations
- ✅ Comprehensive test coverage
- ✅ User documentation

**Testing strategy:**
- Unit tests for all backend services
- Component tests for all UI components
- Integration tests for API endpoints
- E2E tests for complete workflows

**Success criteria:**
- Zero blocked file types bypass
- All tests passing
- Clean typecheck
- Successful build
- Manual smoke test passes
