const API_BASE = "/api/appointments";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Service {
  id: string;
  name: string;
  description: string | null;
  cost: string | null;
  duration: string | null;
  visible: boolean;
  slug: string | null;
  recurrenceType: string | null;
  startTime: string | null;
  endTime: string | null;
  imageUrl: string | null;
  categories?: Array<{ id: string; name: string | null }>;
  salesPrice: string | null;
  paymentOption: string | null;
}

export interface PaginatedResponse<T> {
  results: T[];
  page: number;
  per_page: number;
  total_count: number;
  total_pages: number;
}

export interface Question {
  id: string;
  body: string;
  required: boolean;
}

export interface PublicStaffMember {
  id: string;
  name: string | null;
  role: string;
}

export interface Booking {
  id: string;
  confirmation_code: string;
  status: string;
  start_time: string;
  end_time: string;
  currency?: string;
}

export interface Addon {
  id: string;
  title: string;
  description: string | null;
  price: string;
  duration: string;
}

export interface CreateBookingPayload {
  service_id: string;
  availability_time: string;
  quantity?: number;
  staff_ids?: string[];
  client: {
    first_name: string;
    last_name: string;
    email: string;
    phone_number?: string;
    notes?: string;
  };
  answers?: Array<{ question_id: string; body: string }>;
  marketing_consent?: boolean;
  coupon_code?: string;
  addon_ids?: string[];
  // discount_amount removed - discount is calculated server-side at checkout
}

// ── Core fetcher ───────────────────────────────────────────────────────────

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed: ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

// ── Health ─────────────────────────────────────────────────────────────────

export function checkHealth() {
  return apiFetch<{ status: string; timestamp: string; message: string }>("/health");
}

// ── Public: services ───────────────────────────────────────────────────────

export function getPublicServices(page = 1, perPage = 50) {
  return apiFetch<PaginatedResponse<Service>>(`/public/services?page=${page}&per_page=${perPage}`);
}

export function getPublicService(id: string) {
  return apiFetch<{ service: Service }>(`/public/services/${id}`);
}

export function getAvailableDates(serviceId: string, startTime: string, endTime: string) {
  return apiFetch<{ available_dates: Array<{ date: string; available: boolean }> }>(
    `/public/services/${serviceId}/available-slots-by-date-range?start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`,
  );
}

export function getAvailabilityTimes(serviceId: string, date: string) {
  return apiFetch<{
    availability_times: Array<{
      start_time: string;
      end_time: string;
      available: boolean;
      remaining_capacity: number | null;
    }>;
  }>(`/public/services/${serviceId}/availability-times?date=${date}`);
}

// ── Public: config ───────────────────────────────────────────────────────

export function getPublicServiceStaff(serviceId: string) {
  return apiFetch<{ staff: PublicStaffMember[]; staffRole: string | null }>(
    `/public/services/${serviceId}/staff`,
  );
}

export function getPublicConfig() {
  return apiFetch<{ config: Record<string, string | null> }>("/public/config");
}

export function getPublicServiceAddons(serviceId: string) {
  return apiFetch<{ addons: Addon[] }>(`/public/services/${serviceId}/addons`);
}

// ── Public: questions ──────────────────────────────────────────────────────

export function getPublicQuestions() {
  return apiFetch<{ questions: Question[] }>("/public/questions");
}

// ── Public: bookings ───────────────────────────────────────────────────────

export function createPublicBooking(data: CreateBookingPayload) {
  return apiFetch<{ booking: Booking }>("/public/bookings", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── Public: coupons ────────────────────────────────────────────────────────

export function incrementCouponUsage(code: string) {
  return apiFetch<void>(`/customer/coupons/${encodeURIComponent(code)}/incrementUse`, {
    method: "POST",
  });
}

export function decrementCouponUsage(code: string) {
  return apiFetch<void>(`/customer/coupons/${encodeURIComponent(code)}/decrementUse`, {
    method: "POST",
  });
}

export function createCheckoutSession(bookingId: string, serviceId: string) {
  return apiFetch<{ checkoutUrl: string | null }>("/payments/create-checkout-session", {
    method: "POST",
    body: JSON.stringify({ bookingId, serviceId }),
  });
}
