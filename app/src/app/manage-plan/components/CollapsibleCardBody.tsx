"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

interface CollapsibleCardBodyProps {
  isExpanded: boolean;
  children: ReactNode;
}

export function CollapsibleCardBody({
  isExpanded,
  children,
}: CollapsibleCardBodyProps) {
  return (
    <div
      className={clsx(
        "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
        isExpanded ? "[grid-template-rows:1fr]" : "[grid-template-rows:0fr]",
      )}
    >
      <div
        className="min-h-0 overflow-hidden"
        aria-hidden={!isExpanded ? true : undefined}
        inert={!isExpanded ? true : undefined}
      >
        <div
          className={clsx(
            "transition-opacity duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
            isExpanded ? "opacity-100" : "opacity-0",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
