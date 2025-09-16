"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import { CodeBlock } from "./code-block";
import { HTMLPreviewStandalone } from "./html-preview";

export type HTMLToolOutputProps = ComponentProps<"div"> & {
  output: unknown;
  errorText?: string;
};

export const HTMLToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: HTMLToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  // Check if this is an HTML file editor tool response with preview data
  const hasHTMLPreview = output && 
    typeof output === 'object' && 
    output.htmlPreview && 
    output.htmlPreview.type === 'html-files' &&
    output.htmlPreview.files &&
    Object.keys(output.htmlPreview.files).length > 0;

  let OutputComponent = <div>{output as ReactNode}</div>;

  if (typeof output === "object") {
    if (hasHTMLPreview) {
      // Render both the JSON output and the HTML preview
      const jsonOutput = { ...output };
      delete jsonOutput.htmlPreview; // Remove htmlPreview from JSON display
      
      OutputComponent = (
        <div className="space-y-4">
          {/* JSON Result */}
          <div>
            <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Tool Result
            </h5>
            <div className="rounded-md bg-muted/50">
              <CodeBlock code={JSON.stringify(jsonOutput, null, 2)} language="json" />
            </div>
          </div>
          
          {/* HTML Preview */}
          <div>
            <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {output.htmlPreview.title || "HTML Preview"}
            </h5>
            <div className="h-96 rounded-md border">
              <HTMLPreviewStandalone 
                files={output.htmlPreview.files}
                title={output.htmlPreview.title}
              />
            </div>
          </div>
        </div>
      );
    } else {
      // Regular JSON output
      OutputComponent = (
        <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
      );
    }
  } else if (typeof output === "string") {
    OutputComponent = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2 p-4", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {OutputComponent}
      </div>
    </div>
  );
};