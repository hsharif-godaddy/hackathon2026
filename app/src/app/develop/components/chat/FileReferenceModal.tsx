'use client'

import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Modal from '@ux/modal';
import Spinner from '@ux/spinner';
import text from '@ux/text';

import FileTree, { FileItem } from '@/app/develop/components/FileTree';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { appService } from '@/services/AppService';

interface FileReferenceModalProps {
  isOpen: boolean;
  appId: string;
  onClose: () => void;
  onFilesSelected: (filePaths: string[]) => void;
}

export default function FileReferenceModal({
  isOpen,
  appId,
  onClose,
  onFilesSelected
}: FileReferenceModalProps) {
  const t = useTranslations();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isLoadingRef = useRef(false);

  // Load files from backend
  const loadFiles = useCallback(async () => {
    if (!appId || isLoadingRef.current) return;

    isLoadingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const result = await appService.getFiles(appId, 5);

      if (result.entries && result.entries.length > 0) {
        const fileTree = buildFileTree(result.entries);
        setFiles(fileTree);
      } else {
        setError('No files found');
      }
    } catch (error) {
      logger.error('file-reference-modal.load-files.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      setError('Failed to load files');
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, [appId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Build hierarchical file tree from flat list
  const buildFileTree = (entries: Array<{name: string; isDirectory: boolean; path: string; depth: number}>): FileItem[] => {
    const root: FileItem[] = [];
    const pathMap = new Map<string, FileItem>();

    entries.forEach(entry => {
      const item: FileItem = {
        name: entry.name,
        type: entry.isDirectory ? 'folder' : 'file',
        path: entry.path,
        children: entry.isDirectory ? [] : undefined,
        extension: entry.isDirectory ? undefined : entry.name.split('.').pop()
      };

      pathMap.set(entry.path, item);

      const parentPath = entry.path.split('/').slice(0, -1).join('/');
      if (parentPath && pathMap.has(parentPath)) {
        const parent = pathMap.get(parentPath);
        if (parent?.children) {
          parent.children.push(item);
        }
      } else {
        root.push(item);
      }
    });

    return root;
  };

  const handleFileSelect = (path: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(path)) {
      newSelected.delete(path);
    } else {
      newSelected.add(path);
    }
    setSelectedFiles(newSelected);
  };

  const handleConfirm = () => {
    const filePaths = Array.from(selectedFiles);
    logger.info('file-reference-modal.files-selected', {
      appId,
      fileCount: filePaths.length
    });
    onFilesSelected(filePaths);
    setSelectedFiles(new Set()); // Clear selection for next time
    onClose();
  };

  const handleClose = () => {
    setSelectedFiles(new Set()); // Clear selection on cancel
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      title={t('builder_filereference_title')}
      onClose={handleClose}
      actions={
        <Box orientation="horizontal" gap="md">
          <Button
            design="secondary"
            text={t('builder_common_cancel')}
            onClick={handleClose}
          />
          <Button
            design="primary"
            text={t('builder_common_add_chat')}
            onClick={handleConfirm}
            disabled={selectedFiles.size === 0}
          />
        </Box>
      }
    >
      <div className="w-full max-w-screen-sm flex flex-col min-h-[400px] max-h-[60vh]">
        {isLoading && (
          <div className="flex items-center justify-center h-64">
            <Spinner size="md" />
          </div>
        )}

        {error && (
          <div className="text-center py-8 text-intents-ux-feedbackCritical-feedbackColor">
            {error}
          </div>
        )}

        {!isLoading && !error && files.length > 0 && (
          <>
            <Box orientation="vertical" gap="md" className="flex-shrink-0">
              <text.p size={0}>
                {t('builder_filereference_description')}
              </text.p>
              <text.p size={0}>
                {t('builder_filereference_files', { count: selectedFiles.size })}
              </text.p>
            </Box>
            <div className="flex-1 min-h-0 mt-3 p-1 border rounded-md overflow-auto">
              <FileTree
                files={files}
                selectedFile={null}
                onFileSelect={handleFileSelect}
                getFileStatus={(path) => selectedFiles.has(path) ? 'modified' : 'normal'}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
