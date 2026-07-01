import { useState } from "react";
import { Tag, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAppConfig } from "@/contexts/AppConfigContext";

interface CouponValidatorProps {
  cartTotal: number; // in cents
  currency?: string;
  onCouponApplied?: (code: string, discount: number) => void;
  onCouponRemoved?: () => void;
}

interface ValidationResult {
  valid: boolean;
  couponDiscount?: number;
  reason?: string;
  code?: string;
  eligible_amount?: number;
}

export default function CouponValidator({
  cartTotal,
  currency: currencyProp,
  onCouponApplied,
  onCouponRemoved,
}: CouponValidatorProps) {
  const { currency: configCurrency } = useAppConfig();
  const currency = currencyProp ?? configCurrency;
  const [couponCode, setCouponCode] = useState("");
  const [validating, setValidating] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [discount, setDiscount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function validateCoupon() {
    if (!couponCode.trim()) {
      setError("Please enter a coupon code");
      return;
    }

    try {
      setValidating(true);
      setError(null);

      const res = await fetch("/api/appointments/public/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          couponCode: couponCode.trim().toUpperCase(),
          cartTotal,
          currency,
        }),
      });

      const data = (await res.json()) as ValidationResult;

      if (data.valid && data.couponDiscount) {
        const code = couponCode.toUpperCase();
        setAppliedCoupon(code);
        setDiscount(data.couponDiscount);
        setError(null);
        setCouponCode("");
        toast.success("Coupon applied successfully!");

        // Notify parent with code and discount
        if (onCouponApplied) {
          onCouponApplied(code, data.couponDiscount);
        }
      } else {
        // Handle validation errors
        let errorMessage = data.reason ?? "Invalid coupon code";

        if (data.code === "AMOUNT_ERROR" && data.eligible_amount) {
          const minAmount = (data.eligible_amount / 100).toFixed(2);
          errorMessage = `Minimum cart value of $${minAmount} required`;
        }

        setError(errorMessage);
        toast.error(errorMessage);
      }
    } catch (error) {
      setError("Failed to validate coupon");
      toast.error("Error validating coupon");
      console.error(error);
    } finally {
      setValidating(false);
    }
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setDiscount(0);
    setError(null);
    setCouponCode("");

    // Notify parent
    if (onCouponRemoved) {
      onCouponRemoved();
    }

    toast.info("Coupon removed");
  }

  // If coupon is applied
  if (appliedCoupon) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 h-5 w-5 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-green-900 dark:text-green-100">
                Coupon Applied: {appliedCoupon}
              </p>
              <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                You're saving ${(discount / 100).toFixed(2)}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={removeCoupon}
            className="text-green-700 hover:text-green-900 dark:text-green-300 dark:hover:text-green-100"
          >
            Remove
          </Button>
        </div>
      </div>
    );
  }

  // Coupon input form
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            type="text"
            placeholder="Enter coupon code"
            value={couponCode}
            onChange={(e) => {
              setCouponCode(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void validateCoupon();
              }
            }}
            className="pl-10"
            disabled={validating}
          />
        </div>
        <Button onClick={() => void validateCoupon()} disabled={validating || !couponCode.trim()}>
          {validating ? "Validating..." : "Apply"}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
