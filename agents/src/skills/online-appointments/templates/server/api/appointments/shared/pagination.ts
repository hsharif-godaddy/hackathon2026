import type { Request } from "express";

export function parsePagination(req: Request) {
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(req.query.per_page as string) || 25, 1), 100);
  const offset = (page - 1) * perPage;
  return { page, perPage, offset };
}

export function paginatedResponse<T>(
  items: T[],
  totalCount: number,
  page: number,
  perPage: number,
) {
  return {
    results: items,
    page,
    per_page: perPage,
    total_count: totalCount,
    total_pages: Math.ceil(totalCount / perPage),
  };
}
