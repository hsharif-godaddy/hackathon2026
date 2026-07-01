import type { ElementType } from "react";
import { useEffect, useState } from "react";
import { CalendarDays, Check, ChevronsUpDown, X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getPublicServices, type Service } from "@/lib/api-client";
import { ServiceCard, type ServiceCardProps } from "./ServiceCard";

const PER_PAGE = 6;

function ServiceCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      <Skeleton className="aspect-video w-full" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-3 h-3 w-20" />
      </div>
    </div>
  );
}

interface Category {
  id: string;
  name: string;
}

interface ServiceGridProps {
  onSelect: (service: Service) => void;
  cardSize?: ServiceCardProps["size"];
  cardActionIcon?: ElementType;
  className?: string;
  showDuration?: boolean;
  showPrice?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ElementType;
}

export function ServiceGrid({
  onSelect,
  cardSize,
  cardActionIcon,
  className,
  showDuration,
  showPrice,
  emptyTitle = "No services available",
  emptyDescription = "Check back later for new offerings.",
  emptyIcon: EmptyIcon = CalendarDays,
}: ServiceGridProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getPublicServices(page, PER_PAGE)
      .then((data) => {
        setServices(data.results);
        setTotalPages(data.total_pages);
        // accumulate categories across pages
        setCategories((prev) => {
          const catMap = new Map(prev.map((c) => [c.id, c.name]));
          data.results.forEach((s) =>
            (s.categories ?? []).forEach((c) => {
              if (c.name) catMap.set(c.id, c.name);
            }),
          );
          return [...catMap.entries()].map(([id, name]) => ({ id, name }));
        });
      })
      .catch(() => setError("Failed to load services. Please refresh the page."))
      .finally(() => setLoading(false));
  }, [page]);

  function toggleCategory(id: string) {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  function removeCategory(id: string) {
    setSelectedCategories((prev) => prev.filter((c) => c !== id));
  }

  const filteredServices =
    selectedCategories.length === 0
      ? services
      : services.filter((s) => (s.categories ?? []).some((c) => selectedCategories.includes(c.id)));

  if (error) {
    return <div className="py-16 text-center text-sm text-muted-foreground">{error}</div>;
  }

  if (loading) {
    return (
      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${className ?? ""}`}>
        {Array.from({ length: PER_PAGE }, (_, i) => `sk-${i}`).map((k) => (
          <ServiceCardSkeleton key={k} />
        ))}
      </div>
    );
  }

  if (services.length === 0 && page === 1) {
    return (
      <div className="py-20 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
          <EmptyIcon size={20} className="text-muted-foreground" />
        </div>
        <p className="font-medium text-foreground">{emptyTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      {categories.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-sm">
                <ChevronsUpDown size={14} />
                Filter by category
                {selectedCategories.length > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                    {selectedCategories.length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0" align="start">
              <Command>
                <CommandInput placeholder="Search categories..." />
                <CommandList>
                  <CommandEmpty>No categories found.</CommandEmpty>
                  <CommandGroup>
                    {categories.map((cat) => (
                      <CommandItem
                        key={cat.id}
                        value={cat.name}
                        onSelect={() => toggleCategory(cat.id)}
                      >
                        <Check
                          size={14}
                          className={cn(
                            "mr-2 shrink-0",
                            selectedCategories.includes(cat.id) ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {cat.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {selectedCategories.map((id) => {
            const cat = categories.find((c) => c.id === id);
            if (!cat) return null;
            return (
              <Badge
                key={id}
                variant="secondary"
                className="cursor-pointer gap-1 pr-1.5"
                onClick={() => removeCategory(id)}
              >
                {cat.name}
                <X size={11} className="opacity-60" />
              </Badge>
            );
          })}

          {selectedCategories.length > 0 && (
            <button
              onClick={() => setSelectedCategories([])}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {filteredServices.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No services match the selected{" "}
          {selectedCategories.length === 1 ? "category" : "categories"}.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredServices.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              onSelect={onSelect}
              size={cardSize}
              actionIcon={cardActionIcon}
              showDuration={showDuration}
              showPrice={showPrice}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && selectedCategories.length === 0 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 1}
          >
            <ChevronLeft size={14} />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page === totalPages}
          >
            Next
            <ChevronRight size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
