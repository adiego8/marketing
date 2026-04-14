"use client";

import { cn } from "@/lib/utils";

interface RatingStarsProps {
  value?: number;
  onChange?: (rating: number) => void;
  readonly?: boolean;
}

export function RatingStars({ value = 0, onChange, readonly = false }: RatingStarsProps) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          className={cn(
            "text-lg transition-colors",
            star <= value ? "text-yellow-500" : "text-zinc-300",
            !readonly && "hover:text-yellow-400 cursor-pointer"
          )}
        >
          ★
        </button>
      ))}
    </div>
  );
}
