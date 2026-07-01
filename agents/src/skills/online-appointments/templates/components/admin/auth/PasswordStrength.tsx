import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
  bars: string[];
}

function evaluate(password: string): StrengthResult {
  if (!password) {
    return {
      score: 0,
      label: "",
      color: "",
      bars: ["bg-muted", "bg-muted", "bg-muted", "bg-muted"],
    };
  }

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const clamped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;

  const meta: Record<1 | 2 | 3 | 4, { label: string; color: string; filled: number }> = {
    1: { label: "Too weak", color: "bg-destructive", filled: 1 },
    2: { label: "Fair", color: "bg-orange-400", filled: 2 },
    3: { label: "Good", color: "bg-yellow-400", filled: 3 },
    4: { label: "Strong", color: "bg-green-500", filled: 4 },
  };

  if (clamped === 0) {
    return {
      score: 0,
      label: "",
      color: "",
      bars: ["bg-muted", "bg-muted", "bg-muted", "bg-muted"],
    };
  }

  const { label, color, filled } = meta[clamped];
  const bars = Array.from({ length: 4 }, (_, i) => (i < filled ? color : "bg-muted"));
  return { score: clamped, label, color, bars };
}

export default function PasswordStrength({ password }: { password: string }) {
  const result = useMemo(() => evaluate(password), [password]);

  if (!password) return null;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {result.bars.map((bar, i) => (
          <div
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            className={cn("h-1 flex-1 rounded-full transition-colors duration-300", bar)}
          />
        ))}
      </div>
      {result.label && (
        <p
          className={cn("text-xs font-medium transition-colors", {
            "text-destructive": result.score === 1,
            "text-orange-500": result.score === 2,
            "text-yellow-600": result.score === 3,
            "text-green-600": result.score === 4,
          })}
        >
          {result.label}
        </p>
      )}
    </div>
  );
}
