import { CheckCircle } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function PaymentSuccessPage() {
  const [params] = useSearchParams();
  const bookingId = params.get("booking_id");

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex justify-center">
          <CheckCircle size={48} className="text-green-500" />
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Payment successful
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Your booking is confirmed. You'll receive a confirmation email shortly.
          </p>
        </div>

        {bookingId && <p className="text-xs text-zinc-400">Booking #{bookingId}</p>}

        <Button asChild className="w-full">
          <Link to="/book">Back to services</Link>
        </Button>
      </div>
    </div>
  );
}
