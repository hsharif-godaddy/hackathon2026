import { useState, useEffect } from 'react';

// Full ISO instants in UTC (e.g. "2026-07-07T23:59:59Z") — injected by the scaffold tool.
const SALE_END = __SALE_END__;
const SALE_START = __SALE_START__;

function useCountdown(targetDate: string) {
  const [timeLeft, setTimeLeft] = useState(getTimeLeft(targetDate));

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(getTimeLeft(targetDate));
    }, 1000);
    return () => clearInterval(timer);
  }, [targetDate]);

  return timeLeft;
}

function getTimeLeft(targetDate: string) {
  const end = new Date(targetDate).getTime();
  const now = Date.now();
  const diff = end - now;

  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, ended: true };

  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
    ended: false,
  };
}

export default function __COMPONENT_NAME__() {
  const now = Date.now();
  const hasStarted = now >= new Date(SALE_START).getTime();
  const hasEnded = now >= new Date(SALE_END).getTime();
  const saleCountdown = useCountdown(SALE_END);
  const startCountdown = useCountdown(SALE_START);

  // SALE ENDED
  if (hasEnded) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center px-6 py-20">
          {/* builder: fill in campaign-ended content — headline, message, and a link back to homepage */}
        </div>
      </section>
    );
  }

  // COMING SOON
  if (!hasStarted) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center px-6 py-20">
          {/* builder: fill in coming-soon content — headline, message, and a link to homepage */}
          <div className="inline-flex gap-4 text-center mb-8">
            <div><span className="font-mono text-2xl text-foreground">{startCountdown.days}</span><p className="text-xs text-foreground/40">days</p></div>
            <div><span className="font-mono text-2xl text-foreground">{startCountdown.hours}</span><p className="text-xs text-foreground/40">hours</p></div>
            <div><span className="font-mono text-2xl text-foreground">{startCountdown.minutes}</span><p className="text-xs text-foreground/40">min</p></div>
            <div><span className="font-mono text-2xl text-foreground">{startCountdown.seconds}</span><p className="text-xs text-foreground/40">sec</p></div>
          </div>
        </div>
      </section>
    );
  }

  // ACTIVE SALE — show countdown to end + campaign content
  return (
    <div className="min-h-screen bg-background">
      {/* COUNTDOWN TIMER — builder: style to match the page design */}
      <div className="bg-foreground text-background py-3 text-center">
        <p className="text-sm font-medium tracking-wide">
          {/* builder: add urgency text around the countdown */}
          <span className="font-mono">
            {saleCountdown.days}d {saleCountdown.hours}h {saleCountdown.minutes}m {saleCountdown.seconds}s
          </span>
        </p>
      </div>

      {/* builder: fill in the full landing page content — hero, offer details, CTA, social proof */}
    </div>
  );
}
