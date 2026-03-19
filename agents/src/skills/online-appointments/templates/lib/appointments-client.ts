import type { TimeSlot, Appointment } from './appointments';

/**
 * API response types
 */
export interface AvailabilityResponse {
  date: string;
  slots: TimeSlot[];
}

export interface CreateAppointmentRequest {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  notes?: string;
}

export interface CreateAppointmentResponse {
  id: string;
  customerName: string;
  customerEmail: string;
  date: string;
  time: string;
  endTime: string;
  status: 'confirmed';
  serviceName: string;
  duration: number;
}

export interface ApiError {
  error: string;
  message: string;
  messageKey?: string; // i18n key for client-side translation
}

/**
 * Appointments API client
 *
 * Centralized API calls for appointment operations.
 * Easy for LLM to extend for new features.
 */
export class AppointmentsClient {
  private baseUrl: string;

  constructor(baseUrl = '/api/appointments') {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetch available time slots for a specific date
   *
   * @param date - Date in YYYY-MM-DD format
   * @returns Available time slots
   * @throws Error with message from API
   */
  async getAvailability(date: string): Promise<AvailabilityResponse> {
    const response = await fetch(`${this.baseUrl}/availability?date=${encodeURIComponent(date)}`);

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(error.message);
    }

    return response.json();
  }

  /**
   * Create a new appointment
   *
   * @param data - Appointment data
   * @returns Created appointment details
   * @throws Error with message from API
   */
  async createAppointment(data: CreateAppointmentRequest): Promise<CreateAppointmentResponse> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(error.message);
    }

    return response.json();
  }

  /**
   * Get all appointments (for admin views)
   *
   * @param filters - Optional filters
   * @returns List of appointments
   */
  async getAppointments(filters?: {
    startDate?: string;
    endDate?: string;
    status?: 'confirmed' | 'cancelled' | 'completed';
  }): Promise<Appointment[]> {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.status) params.append('status', filters.status);

    const url = params.toString() ? `${this.baseUrl}?${params}` : this.baseUrl;
    const response = await fetch(url);

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(error.message);
    }

    return response.json();
  }

  /**
   * Cancel an appointment
   *
   * @param appointmentId - Appointment ID
   * @returns Updated appointment
   */
  async cancelAppointment(appointmentId: string): Promise<Appointment> {
    const response = await fetch(`${this.baseUrl}/${encodeURIComponent(appointmentId)}/cancel`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(error.message);
    }

    return response.json();
  }

  /**
   * Parse error response from API
   */
  private async parseError(response: Response): Promise<ApiError> {
    try {
      return await response.json();
    } catch {
      return {
        error: 'Error',
        message: `Request failed with status ${response.status}`,
      };
    }
  }
}

// Default client instance
export const appointmentsClient = new AppointmentsClient();
