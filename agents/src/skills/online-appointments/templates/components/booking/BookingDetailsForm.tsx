import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAppConfig } from "@/contexts/AppConfigContext";
import {
  createPublicBooking,
  createCheckoutSession,
  getPublicQuestions,
  getPublicServiceAddons,
  getPublicServiceStaff,
  incrementCouponUsage,
  decrementCouponUsage,
  type Addon,
  type Booking,
  type PublicStaffMember,
  type Question,
  type Service,
} from "@/lib/api-client";
import { AddonSelector } from "../addons/AddonSelector";
import { formatSlotTime, formatFullDate } from "./slot-utils";
import { formatCost } from "./service-utils";
import CouponValidator from "@/components/coupons/CouponValidator";
import { FeatureGate, useFeatureFlags } from "@/contexts/FeatureFlagsContext";

const detailsSchema = z.object({
  first_name: z.string().min(1, "Required"),
  last_name: z.string().min(1, "Required"),
  email: z.string().email("Enter a valid email"),
  phone_number: z.string().optional(),
  notes: z.string().optional(),
  answers: z.array(z.object({ question_id: z.string(), body: z.string() })),
});

type DetailsValues = z.infer<typeof detailsSchema>;

interface BookingDetailsFormProps {
  service: Service;
  selectedDate: Date;
  selectedTime: string;
  selectedStaffId?: string;
  onStaffSelect?: (staffId: string | undefined) => void;
  onSuccess: (
    booking: Booking,
    addons?: Array<{ id: string; name: string; price: number }>,
  ) => void;
  onBack: () => void;
  /** Pre-fetched staff list from parent to avoid double-fetching. */
  preloadedStaff?: PublicStaffMember[];
  /** Override the submit button label. Defaults to AppConfig.booking.submitLabel. */
  submitLabel?: string;
  /** Override the back button label. */
  backLabel?: string;
  /** Business timezone for displaying times correctly. */
  timezone?: string;
}

export function BookingDetailsForm({
  service,
  selectedDate,
  selectedTime,
  selectedStaffId,
  onStaffSelect,
  onSuccess,
  onBack,
  preloadedStaff,
  submitLabel,
  backLabel = "Back",
  timezone,
}: BookingDetailsFormProps) {
  const { booking: bookingConfig, currency } = useAppConfig();
  const { isEnabled } = useFeatureFlags();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const [discount, setDiscount] = useState(0);
  const [eligibleStaff, setEligibleStaff] = useState<PublicStaffMember[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);

  // Calculate totals
  const serviceCost = service.cost ? parseFloat(service.cost) : 0;
  const addonsCost = selectedAddonIds.reduce((sum, addonId) => {
    const addon = addons.find((a) => a.id === addonId);
    return sum + (addon?.price ? parseFloat(addon.price) : 0);
  }, 0);
  const subtotal = serviceCost + addonsCost;
  const finalTotal = subtotal - discount / 100;

  const form = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone_number: "",
      notes: "",
      answers: [],
    },
  });

  useEffect(() => {
    void (async () => {
      try {
        const data = await getPublicQuestions();
        setQuestions(data.questions);
        form.setValue(
          "answers",
          data.questions.map((q: Question) => ({ question_id: q.id, body: "" })),
        );
      } catch {
        // questions unavailable
      }
    })();
  }, [form]);

  // Only require payment if the payment feature is enabled
  const requiresPayment = isEnabled("customer.booking_flow.payment");

  useEffect(() => {
    if (preloadedStaff) {
      setEligibleStaff(preloadedStaff);
      return;
    }
    void (async () => {
      try {
        const data = await getPublicServiceStaff(service.id);
        setEligibleStaff(data.staff);
      } catch {
        // staff unavailable — picker stays hidden
      }
    })();
  }, [service.id, preloadedStaff]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await getPublicServiceAddons(service.id);
        setAddons(data.addons);
      } catch (err) {
        console.error("booking_flow.fetch_addons.failed", {
          serviceId: service.id,
          error: err instanceof Error ? err.message : String(err),
        });
        setAddons([]);
      }
    })();
  }, [service.id]);

  async function onSubmit(values: DetailsValues) {
    setSubmitError(null);

    // Increment coupon usage if one was applied
    if (appliedCouponCode) {
      try {
        await incrementCouponUsage(appliedCouponCode);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Failed to apply coupon");
        return;
      }
    }

    // Try to create the booking
    let result;
    try {
      result = await createPublicBooking({
        service_id: service.id,
        availability_time: selectedTime,
        quantity: 1,
        staff_ids: selectedStaffId ? [selectedStaffId] : undefined,
        client: {
          first_name: values.first_name,
          last_name: values.last_name,
          email: values.email,
          phone_number: values.phone_number !== "" ? values.phone_number : undefined,
          notes: values.notes !== "" ? values.notes : undefined,
        },
        answers: values.answers.filter((a) => a.body.trim()),
        coupon_code: appliedCouponCode ?? undefined,
        addon_ids: selectedAddonIds.length > 0 ? selectedAddonIds : undefined,
      });

      // Pass selected addons to parent
      const selectedAddonsData = selectedAddonIds
        .map((id) => {
          const addon = addons.find((a) => a.id === id);
          if (!addon) return null;
          return {
            id: addon.id,
            name: addon.title,
            price: parseFloat(addon.price),
          };
        })
        .filter((a): a is { id: string; name: string; price: number } => a !== null);

      onSuccess(result.booking, selectedAddonsData.length > 0 ? selectedAddonsData : undefined);
    } catch (err) {
      // Booking failed - roll back coupon increment
      if (appliedCouponCode) {
        try {
          await decrementCouponUsage(appliedCouponCode);
        } catch {
          // Silently ignore decrement errors
        }
      }
      setSubmitError(err instanceof Error ? err.message : "Booking failed. Please try again.");
      return;
    }

    // Booking succeeded, now handle payment if required
    if (requiresPayment) {
      try {
        const { checkoutUrl } = await createCheckoutSession(result.booking.id, service.id);
        if (checkoutUrl) {
          window.location.href = checkoutUrl;
          return;
        }
        // No checkout URL returned means payment not required after all
      } catch (_err) {
        // Payment setup failed, but booking was already created
        // Show error but don't roll back - user can contact support to pay
        setSubmitError(
          "Your booking was created, but we couldn't set up payment. Please contact us to complete payment.",
        );
        return;
      }
    }

    onSuccess(result.booking);
  }

  function handleCouponApplied(code: string, discountAmount: number) {
    setAppliedCouponCode(code);
    setDiscount(discountAmount);
  }

  function handleCouponRemoved() {
    setAppliedCouponCode(null);
    setDiscount(0);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <p className="font-medium text-foreground">{service.name}</p>
        <p className="mt-0.5 text-muted-foreground">
          {formatFullDate(selectedDate)} · {formatSlotTime(selectedTime, timezone)}
        </p>
        {service.cost && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Service</span>
              <span className="font-medium text-foreground">
                {formatCost(service.cost, currency)}
              </span>
            </div>
            {selectedAddonIds.length > 0 && (
              <>
                {selectedAddonIds.map((addonId) => {
                  const addon = addons.find((a) => a.id === addonId);
                  if (!addon) return null;
                  return (
                    <div key={addon.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">+ {addon.title}</span>
                      <span className="font-medium text-foreground">
                        {formatCost(addon.price, currency)}
                      </span>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between border-t border-border pt-1 text-xs">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-semibold text-foreground">
                    {formatCost(String(subtotal), currency)}
                  </span>
                </div>
              </>
            )}
            {discount > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-green-600 dark:text-green-400">Discount</span>
                <span className="font-medium text-green-600 dark:text-green-400">
                  -{formatCost(String(discount / 100), currency)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border pt-1.5">
              <span className="text-sm font-semibold text-foreground">Total</span>
              <span className="text-sm font-bold text-foreground">
                {formatCost(String(finalTotal), currency)}
              </span>
            </div>
          </div>
        )}
      </div>

      <FeatureGate feature="customer.booking_flow.staff_selection">
        {eligibleStaff.length > 0 && onStaffSelect && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium text-foreground">Staff preference</p>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
                <input
                  type="radio"
                  name="staff"
                  value=""
                  checked={!selectedStaffId}
                  onChange={() => onStaffSelect(undefined)}
                  className="accent-primary"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">No preference</p>
                  <p className="text-xs text-muted-foreground">Any available staff member</p>
                </div>
              </label>
              {eligibleStaff.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                >
                  <input
                    type="radio"
                    name="staff"
                    value={s.id}
                    checked={selectedStaffId === s.id}
                    onChange={() => onStaffSelect(s.id)}
                    className="accent-primary"
                  />
                  <div className="flex items-center gap-2.5">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                        {(s.name ?? "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium text-foreground">{s.name ?? "Staff"}</p>
                      <p className="text-xs capitalize text-muted-foreground">{s.role}</p>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </FeatureGate>

      <form
        onSubmit={(e) => {
          void form.handleSubmit(onSubmit)(e);
        }}
        className="space-y-4"
        noValidate
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={form.formState.errors.first_name?.message}>
            <Input {...form.register("first_name")} placeholder="Jane" />
          </Field>
          <Field label="Last name" error={form.formState.errors.last_name?.message}>
            <Input {...form.register("last_name")} placeholder="Smith" />
          </Field>
        </div>

        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" {...form.register("email")} placeholder="jane@example.com" />
        </Field>

        <Field label="Phone number" hint="Optional">
          <Input type="tel" {...form.register("phone_number")} placeholder="+1 (555) 000-0000" />
        </Field>

        <Field label="Notes" hint="Optional">
          <Textarea
            {...form.register("notes")}
            placeholder="Anything you'd like us to know…"
            rows={3}
            className="resize-none"
          />
        </Field>

        <FeatureGate feature="customer.booking_flow.addons">
          {addons.length > 0 && (
            <div className="pt-1">
              <AddonSelector
                addons={addons}
                selectedIds={selectedAddonIds}
                onChange={setSelectedAddonIds}
              />
            </div>
          )}
        </FeatureGate>

        {questions.map((q, idx) => (
          <Field key={q.id} label={q.body} hint={q.required ? undefined : "Optional"}>
            <Textarea {...form.register(`answers.${idx}.body`)} rows={2} className="resize-none" />
          </Field>
        ))}

        {/* Coupon code section */}
        <FeatureGate feature="customer.booking_flow.coupons">
          {service.cost && (
            <div className="pt-2">
              <CouponValidator
                cartTotal={Math.round(subtotal * 100)}
                onCouponApplied={handleCouponApplied}
                onCouponRemoved={handleCouponRemoved}
              />
            </div>
          )}
        </FeatureGate>

        {submitError && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {submitError}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" onClick={onBack} className="flex-1">
            {backLabel}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting} className="flex-1">
            {form.formState.isSubmitting ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" />
                {requiresPayment ? "Redirecting to payment…" : "Booking…"}
              </>
            ) : requiresPayment ? (
              `Pay ${formatCost(String(finalTotal), currency)}`
            ) : (
              (submitLabel ?? bookingConfig.submitLabel)
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  type ChildProps = {
    id?: string;
    "aria-labelledby"?: string;
  };
  const child = isValidElement(children) ? (children as ReactElement<ChildProps>) : null;
  const childWithProps = child
    ? cloneElement(child as ReactElement<{ id?: string; "aria-labelledby"?: string }>, {
        id: child.props.id ?? `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-field`,
        "aria-labelledby": `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-label`,
      })
    : children;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label
          id={`${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-label`}
          className="text-sm font-medium text-foreground"
        >
          {label}
        </Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {childWithProps}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
