import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface SortableWidgetProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function SortableWidget({ id, children, className }: SortableWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn("group relative", isDragging && "z-50 opacity-50", className)}
    >
      {/* Drag handle — appears on hover, sits in the card's top-left padding gap */}
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder widget"
        className={cn(
          "absolute left-3 top-3 z-10 rounded-md p-1",
          "opacity-0 transition-opacity duration-150 group-hover:opacity-100",
          "cursor-grab active:cursor-grabbing",
          "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}
