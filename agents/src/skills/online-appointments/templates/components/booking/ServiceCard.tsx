import type { ElementType } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Service } from "@/lib/api-client";
import { formatCost, formatDuration } from "./service-utils";
import { Badge } from "@/components/ui/badge";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

export interface ServiceCardProps {
  service: Service;
  onSelect: (service: Service) => void;
  actionIcon?: ElementType;
  className?: string;
  showDuration?: boolean;
  showPrice?: boolean;
  showImage?: boolean;
  showCategories?: boolean;
  size?: "sm" | "default" | "lg";
  /** Extra images beyond service.imageUrl for the carousel. Optional. */
  extraImages?: string[];
}

export function ServiceCard({
  service,
  onSelect,
  className,
  showDuration = true,
  showPrice = true,
  showImage = true,
  showCategories = true,
  extraImages,
}: ServiceCardProps) {
  const { currency } = useAppConfig();
  const visibleCategories = (service.categories ?? []).filter((c) => c.name);
  const primaryCategory = visibleCategories[0];
  const cost = formatCost(service.cost, currency);
  const isFree = cost === "Free";

  const images: string[] = [
    ...(service.imageUrl ? [service.imageUrl] : []),
    ...(extraImages ?? []),
  ];
  const hasImages = showImage && images.length > 0;
  const isMulti = images.length > 1;

  return (
    <button
      onClick={() => onSelect(service)}
      className={cn(
        "group w-full overflow-hidden rounded-xl text-left",
        "border border-border/60 bg-card",
        "transition-all duration-200 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {/* Image zone — only rendered when images exist, no placeholder shown */}
      {hasImages && (
        <div className="relative overflow-hidden bg-muted">
          {isMulti ? (
            <Carousel opts={{ loop: true }} className="w-full" onClick={(e) => e.stopPropagation()}>
              <CarouselContent>
                {images.map((src, i) => (
                  <CarouselItem key={src}>
                    <AspectRatio ratio={16 / 9}>
                      <img
                        src={src}
                        alt={`${service.name} ${i + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </AspectRatio>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious className="left-2 h-7 w-7" />
              <CarouselNext className="right-2 h-7 w-7" />
            </Carousel>
          ) : (
            <AspectRatio ratio={16 / 9}>
              <img
                src={images[0]}
                alt={service.name}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </AspectRatio>
          )}

          {/* Price pill — overlaid on image */}
          {showPrice && (
            <div
              className={cn(
                "absolute right-2.5 top-2.5 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow backdrop-blur-sm",
                isFree ? "bg-green-500/90 text-white" : "bg-background/90 text-foreground",
              )}
            >
              {cost}
            </div>
          )}

          {/* Category pill — overlaid on image */}
          {showCategories && primaryCategory?.name && (
            <div className="absolute left-2.5 top-2.5">
              <Badge
                variant="secondary"
                className="bg-background/85 px-2 py-0.5 text-xs text-foreground shadow-sm backdrop-blur-sm"
              >
                {primaryCategory.name}
              </Badge>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold leading-snug text-foreground">
            {service.name}
          </h3>
          {/* Price shown inline when no image */}
          {!hasImages && showPrice && (
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                isFree ? "bg-green-500/15 text-green-700" : "bg-muted text-foreground",
              )}
            >
              {cost}
            </span>
          )}
        </div>
        {!hasImages && showCategories && primaryCategory?.name && (
          <Badge variant="secondary" className="mt-1 px-2 py-0.5 text-xs">
            {primaryCategory.name}
          </Badge>
        )}
        {service.description && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {service.description}
          </p>
        )}
        {showDuration && service.duration && (
          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock size={11} />
            <span>{formatDuration(service.duration)}</span>
          </div>
        )}
      </div>
    </button>
  );
}
