'use client'

import { useEffect, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Modal from '@ux/modal';
import Spinner from '@ux/spinner';
import text from '@ux/text';

import FileTree from '@/app/[market]/develop/components/FileTree';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { useFileTreeStore } from '@/stores/useFileTreeStore';

interface FileReferenceModalProps {
  isOpen: boolean;
  appId: string;
  onClose: () => void;
  onFilesSelected: (filePaths: string[]) => void;
}

const EMPTY_ARRAY: never[] = [];

export default function FileReferenceModal({
  isOpen,
  appId,
  onClose,
  onFilesSelected
}: FileReferenceModalProps) {
  const t = useTranslations();
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Subscribe to file tree store for shared state
  const files = useFileTreeStore((state) => state.files[appId] ?? EMPTY_ARRAY);
  const isLoading = useFileTreeStore((state) => state.loading[appId] ?? false);
  const error = useFileTreeStore((state) => state.errors[appId] ?? null);

  // Load files when modal opens (cache-first, only fetches if needed)
  useEffect(() => {
    if (isOpen && appId) {
      useFileTreeStore.getState().loadFilesFromCacheOrFetch(appId);
    }
  }, [isOpen, appId]);

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
        {isLoading && files.length === 0 && (
          <div className="flex items-center justify-center h-64">
            <Spinner size="md" />
          </div>
        )}

        {error && files.length === 0 && (
          <div className="text-center py-8 text-intents-ux-feedbackCritical-feedbackColor">
            {error}
          </div>
        )}

        {/* Apps are initialized from boilerplate templates with multiple files, so empty state UI is not needed */}
        {files.length > 0 && (
          <>
            {error && (
              <div className="mb-2 px-3 py-2 text-sm rounded-md bg-intents-ux-feedbackHighContrastCritical-feedbackColor/10 text-intents-ux-feedbackHighContrastCritical-feedbackColor">
                {error}
              </div>
            )}
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
