import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one way to show a failure next to the control that caused it.
 *
 * Mirrors car-sales-os/components/ui/FormError.tsx, including the reasoning:
 * a bare `<p className="text-sm text-red-600">` is invisible to a screen
 * reader. The text appears, nothing announces it, and someone using VoiceOver
 * gets no signal that their save failed.
 *
 * `role="alert"` carries an implicit `aria-live="assertive"`, so the message is
 * announced the moment it renders. That is the right level here — these appear
 * in response to a deliberate action (save, create, connect) and the person is
 * waiting on the outcome.
 *
 * Renders nothing when there is no error, so callers drop it in
 * unconditionally instead of wrapping every use in `{error && …}`.
 */
export interface FormErrorProps {
  /** The message. Null, undefined or empty renders nothing. */
  children?: ReactNode;
  /** Lets a field point at this message with aria-describedby. */
  id?: string;
  className?: string;
}

export function FormError({ children, id, className }: FormErrorProps) {
  if (!children) return null;

  return (
    <p
      id={id}
      role="alert"
      className={cn("mt-1.5 text-sm text-red-600", className)}
    >
      {children}
    </p>
  );
}
