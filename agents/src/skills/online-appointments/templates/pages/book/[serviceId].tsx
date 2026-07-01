import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Helmet } from "@dr.pogodin/react-helmet";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingWizard } from "@/components/booking";
import { getPublicService, getPublicConfig, type Service } from "@/lib/api-client";

export default function BookServicePage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const id = serviceId ?? "";

  const [service, setService] = useState<Service | null>(null);
  const [timezone, setTimezone] = useState<string>("UTC");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("Invalid service.");
      setLoading(false);
      return;
    }
    Promise.all([getPublicService(id), getPublicConfig()])
      .then(([serviceData, configData]) => {
        setService(serviceData.service);
        setTimezone(configData.config.timezone ?? "UTC");
      })
      .catch(() => setError("Service not found."))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 size={24} className="animate-spin" />
      </main>
    );
  }

  if (error || !service) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="mb-4 text-sm text-muted-foreground">{error ?? "Service not found."}</p>
        <Button asChild variant="outline">
          <Link to="/book">← Back to services</Link>
        </Button>
      </main>
    );
  }

  return (
    <>
      <Helmet>
        <title>Book — {service.name}</title>
      </Helmet>
      <main className="mx-auto w-1/2 px-4 py-12">
        <BookingWizard service={service} timezone={timezone} onBack={() => window.history.back()} />
      </main>
    </>
  );
}
