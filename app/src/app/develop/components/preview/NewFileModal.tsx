'use client'

import path from 'path-browserify';
import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Modal from '@ux/modal';

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
    <Modal
      title="New File"
      onClose={handleClose}
      centered
      actions={
        <Box orientation="horizontal" gap="md">
          <Button
            design="secondary"
            text="Cancel"
            onClick={handleClose}
          />
          <Button
            design="primary"
            text="Create"
            onClick={handleCreate}
            disabled={!filename.trim()}
          />
        </Box>
      }
    >
      <div className="space-y-2">
        <label htmlFor="filename" className="text-sm font-medium">
          Filename
        </label>
        <input
          id="filename"
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="filename.ext"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filename.trim()) {
              handleCreate();
            }
          }}
          autoFocus
          className="w-full px-3 py-2 border rounded-md"
        />
        <p className="text-xs text-neutral-600">
          Location: {targetPath}
        </p>
      </div>
    </Modal>
  );
}
