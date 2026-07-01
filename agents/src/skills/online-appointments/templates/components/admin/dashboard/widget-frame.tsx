import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface WidgetFrameProps {
  title: string;
  description?: string;
  loading?: boolean;
  className?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export function WidgetFrame({
  title,
  description,
  loading = false,
  className,
  headerAction,
  children,
}: WidgetFrameProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
            {description && <CardDescription className="mt-0.5">{description}</CardDescription>}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      </CardHeader>
      <CardContent className="flex-1 pt-0">{loading ? <WidgetSkeleton /> : children}</CardContent>
    </Card>
  );
}

function WidgetSkeleton() {
  return (
    <div className="space-y-3 pt-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}
