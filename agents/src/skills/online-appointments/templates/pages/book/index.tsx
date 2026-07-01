import { Helmet } from "@dr.pogodin/react-helmet";
import { useNavigate } from "react-router-dom";
import { ServiceGrid } from "@/components/booking";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { type Service } from "@/lib/api-client";

export default function BookPage() {
  const navigate = useNavigate();
  const { booking } = useAppConfig();

  function handleSelect(service: Service) {
    void navigate(`/book/${service.id}`);
  }

  return (
    <>
      <Helmet>
        <title>Book an Appointment</title>
      </Helmet>

      <main className="mx-auto w-1/2 px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{booking.pageTitle}</h1>
          {booking.pageSubtitle && (
            <p className="mt-2 text-base text-muted-foreground">{booking.pageSubtitle}</p>
          )}
        </div>
        <ServiceGrid onSelect={handleSelect} />
      </main>
    </>
  );
}
