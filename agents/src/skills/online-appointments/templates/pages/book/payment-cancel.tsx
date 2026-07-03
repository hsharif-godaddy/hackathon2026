import { XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function PaymentCancelPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex justify-center">
          <XCircle size={48} className="text-red-400" />
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Payment cancelled
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Your payment was not completed. Your booking slot has been held — you can try again or
            go back to browse services.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link to="/book">Back to services</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
