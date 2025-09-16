"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  CodeIcon,
  EyeIcon,
  FileIcon,
  RefreshCwIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { createContext, useContext, useState, useMemo } from "react";
import { CodeBlock } from "./code-block";

export type HTMLFile = {
  path: string;
  content: string;
};

export type HTMLPreviewContextValue = {
  files: Record<string, string>;
  activeFile: string;
  setActiveFile: (path: string) => void;
  previewOpen: boolean;
  setPreviewOpen: (open: boolean) => void;
};

const HTMLPreviewContext = createContext<HTMLPreviewContextValue | null>(null);

const useHTMLPreview = () => {
  const context = useContext(HTMLPreviewContext);
  if (!context) {
    throw new Error("HTMLPreview components must be used within an HTMLPreview");
  }
  return context;
};

export type HTMLPreviewProps = ComponentProps<"div"> & {
  files?: Record<string, string>;
  defaultActiveFile?: string;
  onActiveFileChange?: (path: string) => void;
};

export const HTMLPreview = ({
  className,
  children,
  files = {},
  defaultActiveFile,
  onActiveFileChange,
  ...props
}: HTMLPreviewProps) => {
  const fileList = Object.keys(files);
  const [activeFile, setActiveFile] = useState(
    defaultActiveFile || fileList.find(f => f.endsWith('.html')) || fileList[0] || ''
  );
  const [previewOpen, setPreviewOpen] = useState(true);

  const handleActiveFileChange = (path: string) => {
    setActiveFile(path);
    onActiveFileChange?.(path);
  };

  const contextValue: HTMLPreviewContextValue = {
    files,
    activeFile,
    setActiveFile: handleActiveFileChange,
    previewOpen,
    setPreviewOpen,
  };

  return (
    <HTMLPreviewContext.Provider value={contextValue}>
      <div
        className={cn(
          "flex flex-col rounded-lg border bg-card overflow-hidden",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </HTMLPreviewContext.Provider>
  );
};

export type HTMLPreviewHeaderProps = ComponentProps<"div"> & {
  title?: string;
  showRefresh?: boolean;
  onRefresh?: () => void;
};

export const HTMLPreviewHeader = ({
  className,
  title = "HTML Preview",
  showRefresh = false,
  onRefresh,
  ...props
}: HTMLPreviewHeaderProps) => {
  const { files, activeFile } = useHTMLPreview();
  const fileCount = Object.keys(files).length;

  return (
    <div
      className={cn("flex items-center justify-between border-b p-3", className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <EyeIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title}</span>
        <Badge variant="secondary" className="text-xs">
          {fileCount} {fileCount === 1 ? 'file' : 'files'}
        </Badge>
        {activeFile && (
          <Badge variant="outline" className="text-xs">
            {activeFile}
          </Badge>
        )}
      </div>
      {showRefresh && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={onRefresh}
        >
          <RefreshCwIcon className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
};

export type HTMLPreviewTabsProps = ComponentProps<"div">;

export const HTMLPreviewTabs = ({ className, ...props }: HTMLPreviewTabsProps) => {
  const { files, activeFile, setActiveFile, previewOpen, setPreviewOpen } = useHTMLPreview();
  const fileList = Object.keys(files);

  if (fileList.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <div className="text-center">
          <FileIcon className="mx-auto h-8 w-8 mb-2" />
          <p className="text-sm">No files available</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-1 flex-col", className)} {...props}>
      <div className="flex items-center border-b p-2 gap-2">
        <div className="flex items-center gap-2">
          <FileIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Files:</span>
        </div>
        <Select value={activeFile} onValueChange={setActiveFile}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Select file" />
          </SelectTrigger>
          <SelectContent>
            {fileList.map((filePath) => (
              <SelectItem key={filePath} value={filePath}>
                <div className="flex items-center gap-2">
                  <FileIcon className="h-3 w-3" />
                  <span className="text-xs">{filePath}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Collapsible open={previewOpen} onOpenChange={setPreviewOpen}>
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">
                <EyeIcon className="mr-1 h-3 w-3" />
                Preview
                <ChevronDownIcon
                  className={cn(
                    "ml-1 h-3 w-3 transition-transform",
                    previewOpen && "rotate-180"
                  )}
                />
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        {activeFile && files[activeFile] && (
          <HTMLPreviewContent filePath={activeFile} content={files[activeFile]} />
        )}
      </div>
    </div>
  );
};

export type HTMLPreviewContentProps = {
  filePath: string;
  content: string;
  className?: string;
};

export const HTMLPreviewContent = ({
  filePath,
  content,
  className
}: HTMLPreviewContentProps) => {
  const { previewOpen } = useHTMLPreview();
  const isHTML = filePath.endsWith('.html');
  const isCSS = filePath.endsWith('.css');
  const isJS = filePath.endsWith('.js');

  const language = isHTML ? 'html' : isCSS ? 'css' : isJS ? 'javascript' : 'text';

  // Create a blob URL for HTML preview
  const htmlBlobUrl = useMemo(() => {
    if (!isHTML || !content) return null;
    
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    
    // Cleanup function will be called when component unmounts or content changes
    return url;
  }, [content, isHTML]);

  // Cleanup blob URL on unmount
  useMemo(() => {
    return () => {
      if (htmlBlobUrl) {
        URL.revokeObjectURL(htmlBlobUrl);
      }
    };
  }, [htmlBlobUrl]);

  return (
    <div className={cn("flex flex-1 flex-col", className)}>
      <Collapsible open={previewOpen} onOpenChange={() => {}}>
        <div className="flex flex-1">
          {/* Code Editor */}
          <div className="flex-1 border-r">
            <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                <CodeIcon className="h-3 w-3" />
                <span className="text-xs font-medium">Code</span>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <CodeBlock 
                code={content} 
                language={language}
                className="rounded-none border-none"
              />
            </div>
          </div>

          {/* Live Preview */}
          <CollapsibleContent className="flex-1">
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <EyeIcon className="h-3 w-3" />
                  <span className="text-xs font-medium">
                    {isHTML ? 'Live Preview' : 'Preview Not Available'}
                  </span>
                </div>
              </div>
              <div className="flex-1">
                {isHTML && htmlBlobUrl ? (
                  <iframe
                    src={htmlBlobUrl}
                    className="w-full h-full border-none"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    title={`Preview of ${filePath}`}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <FileIcon className="mx-auto h-8 w-8 mb-2" />
                      <p className="text-sm">
                        {isHTML 
                          ? 'No HTML content to preview'
                          : 'Live preview only available for HTML files'
                        }
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
};

export type HTMLPreviewStandaloneProps = {
  files: Record<string, string>;
  className?: string;
  title?: string;
};

export const HTMLPreviewStandalone = ({
  files,
  className,
  title = "HTML Files"
}: HTMLPreviewStandaloneProps) => {
  return (
    <HTMLPreview files={files} className={className}>
      <HTMLPreviewHeader title={title} />
      <HTMLPreviewTabs />
    </HTMLPreview>
  );
};