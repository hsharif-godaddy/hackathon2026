import type { ElementType } from "react";
import { useEffect, useState } from "react";
import { ArrowLeft, Clock, CalendarDays, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppConfig } from "@/contexts/AppConfigContext";
import {
  type Booking,
  type PublicStaffMember,
  type Service,
  getPublicServiceStaff,
} from "@/lib/api-client";
import { formatCost, formatDuration } from "./service-utils";
import { formatFullDate, formatSlotTime } from "./slot-utils";
import { StepIndicator, type BookingStep } from "./StepIndicator";
import { DatePicker } from "./DatePicker";
import { TimeSlotPicker } from "./TimeSlotPicker";
import { BookingDetailsForm } from "./BookingDetailsForm";
import { BookingConfirmation } from "./BookingConfirmation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AspectRatio } from "@/components/ui/aspect-ratio";

interface BookingWizardProps {
  service: Service;
  timezone: string;
  onBack: () => void;
  backToServicesLabel?: string;
  backIcon?: ElementType;
  confirmationIcon?: ElementType;
  className?: string;
}

interface ServiceInfoPanelProps {
  service: Service;
  staff: PublicStaffMember[];
  selectedDate?: Date;
  selectedTime?: string;
  selectedStaffId?: string;
}

function ServiceInfoPanel({
  service,
  staff,
  selectedDate,
  selectedTime,
  selectedStaffId,
}: ServiceInfoPanelProps) {
  const visibleCategories = (service.categories ?? []).filter((c) => c.name);
  const selectedStaff = selectedStaffId ? staff.find((s) => s.id === selectedStaffId) : undefined;

  // Show team avatar stack only when no staff is selected yet
  const showTeam = staff.length > 0 && !selectedStaffId;
  const displayedStaff = staff.slice(0, 4);
  const staffOverflow = staff.length > 4 ? staff.length - 4 : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {service.imageUrl && (
        <div className="hidden lg:block">
          <AspectRatio ratio={16 / 9}>
            <img src={service.imageUrl} alt={service.name} className="h-full w-full object-cover" />
          </AspectRatio>
        </div>
      )}

      <div className="space-y-4 p-5">
        {/* Service name + meta */}
        <div>
          <h2 className="text-lg font-semibold text-foreground">{service.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {service.duration && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock size={13} />
                {formatDuration(service.duration)}
              </span>
            )}
            {service.cost && (
              <span className="text-sm font-medium text-foreground">
                {formatCost(service.cost, currency)}
              </span>
            )}
          </div>
        </div>

        {service.description && (
          <p className="hidden text-sm leading-relaxed text-muted-foreground lg:block">
            {service.description}
          </p>
        )}

        {/* Selected booking summary — builds progressively */}
        {(selectedDate !== undefined ||
          selectedTime !== undefined ||
          selectedStaff !== undefined) && (
          <>
            <Separator />
            <div className="space-y-2.5">
              {selectedDate && (
                <div className="flex items-center gap-2.5 text-sm">
                  <CalendarDays size={14} className="shrink-0 text-primary" />
                  <span className="font-medium text-foreground">
                    {formatFullDate(selectedDate)}
                  </span>
                </div>
              )}
              {selectedTime && (
                <div className="flex items-center gap-2.5 text-sm">
                  <Clock size={14} className="shrink-0 text-primary" />
                  <span className="font-medium text-foreground">
                    {formatSlotTime(selectedTime)}
                  </span>
                </div>
              )}
              {selectedStaff && (
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 size={14} className="shrink-0 text-primary" />
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                        {(selectedStaff.name ?? "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium text-foreground">
                      {selectedStaff.name ?? "Staff"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {(visibleCategories.length > 0 || showTeam) && <Separator />}

        {visibleCategories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {visibleCategories.map((cat) => (
              <Badge key={cat.id} variant="secondary" className="text-xs">
                {cat.name}
              </Badge>
            ))}
          </div>
        )}

        {showTeam && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Team
            </p>
            <div className="flex items-center">
              <div className="flex -space-x-2">
                {displayedStaff.map((s) => (
                  <Avatar key={s.id} className="h-8 w-8 border-2 border-card">
                    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                      {(s.name ?? "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {staffOverflow > 0 && (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-card bg-muted text-xs font-semibold text-muted-foreground">
                    +{staffOverflow}
                  </div>
                )}
              </div>
              <p className="ml-3 text-xs text-muted-foreground">
                {staff.length === 1
                  ? (staff[0]?.name ?? "1 team member")
                  : `${staff.length} team members`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function BookingWizard({
  service,
  timezone,
  onBack,
  backToServicesLabel,
  backIcon: BackIcon = ArrowLeft,
  confirmationIcon,
  className,
}: BookingWizardProps) {
  const { booking: bookingConfig, currency } = useAppConfig();

  const [step, setStep] = useState<BookingStep>("date");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | undefined>();
  const [selectedStaffId, setSelectedStaffId] = useState<string | undefined>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [eligibleStaff, setEligibleStaff] = useState<PublicStaffMember[]>([]);

  useEffect(() => {
    getPublicServiceStaff(service.id)
      .then((d) => setEligibleStaff(d.staff))
      .catch(() => undefined);
  }, [service.id]);

  function handleDateSelect(date: Date) {
    setSelectedDate(date);
    setSelectedTime(undefined);
    setStep("time");
  }

  function handleTimeSelect(time: string) {
    setSelectedTime(time);
    setStep("details");
  }

  function handleBookingSuccess(b: Booking) {
    setBooking(b);
    setStep("confirmation");
  }

  function reset() {
    setStep("date");
    setSelectedDate(undefined);
    setSelectedTime(undefined);
    setSelectedStaffId(undefined);
    setBooking(null);
  }

  const isConfirmation = step === "confirmation";
  const backLabel = backToServicesLabel ?? bookingConfig.backToServicesLabel;

  return (
    <div className={cn("w-full", className)}>
      <button
        onClick={isConfirmation ? reset : onBack}
        className={cn(
          "inline-flex items-center gap-1.5 text-sm text-muted-foreground",
          "mb-6 transition-colors hover:text-foreground",
        )}
      >
        <BackIcon size={14} />
        {isConfirmation ? bookingConfig.backToServicesLabel : backLabel}
      </button>

      {isConfirmation ? (
        <BookingConfirmation
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          booking={booking!}
          service={service}
          onBookAnother={reset}
          icon={confirmationIcon}
        />
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(240px,_380px)_minmax(50%,_1fr)] lg:items-start">
          <div className="lg:sticky lg:top-8">
            <ServiceInfoPanel
              service={service}
              staff={eligibleStaff}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              selectedStaffId={selectedStaffId}
            />
          </div>

          <div className="space-y-6">
            <StepIndicator current={step} />

            {step === "date" && (
              <DatePicker
                serviceId={service.id}
                service={service}
                timezone={timezone}
                selectedDate={selectedDate}
                onSelect={handleDateSelect}
              />
            )}

            {step === "time" && selectedDate && (
              <TimeSlotPicker
                serviceId={service.id}
                date={selectedDate}
                selectedTime={selectedTime}
                onSelect={handleTimeSelect}
                onChangeDate={() => setStep("date")}
                timezone={timezone}
              />
            )}

            {step === "details" && selectedDate && selectedTime && (
              <BookingDetailsForm
                service={service}
                selectedDate={selectedDate}
                selectedTime={selectedTime}
                selectedStaffId={selectedStaffId}
                onStaffSelect={setSelectedStaffId}
                onSuccess={handleBookingSuccess}
                onBack={() => setStep("time")}
                preloadedStaff={eligibleStaff}
                timezone={timezone}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
