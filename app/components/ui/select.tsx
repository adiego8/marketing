"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import {
  FIELD_BASE,
  FIELD_INVALID,
  FIELD_SIZES,
  FieldShell,
  useFieldIds,
  type FieldSize,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * A native select with the platform arrow replaced by a lucide one, so it
 * matches every other chevron in the app instead of whatever the OS draws.
 *
 * Native rather than a Base UI popup on purpose: these are short, flat option
 * lists, and the native control brings keyboard behaviour and mobile pickers
 * for free.
 */
export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  error?: string;
  helperText?: string;
  size?: FieldSize;
  options?: Array<{ value: string; label: string }>;
  /**
   * The wrapper is `w-full`, which is right in a form row and wrong in a
   * toolbar. Pass `w-auto` to let the control size to its content.
   */
  wrapperClassName?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      label,
      error,
      helperText,
      size = "md",
      options,
      className,
      wrapperClassName,
      children,
      ...props
    },
    ref
  ) {
    const { id, errorId, helperId, describedBy } = useFieldIds(
      props.id,
      error,
      helperText
    );

    return (
      <FieldShell
        label={label}
        id={id}
        required={props.required}
        error={error}
        errorId={errorId}
        helperText={helperText}
        helperId={helperId}
        className={wrapperClassName}
      >
        <div className="relative">
          <select
            ref={ref}
            {...props}
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(
              FIELD_BASE,
              FIELD_SIZES[size],
              "cursor-pointer appearance-none pr-9",
              error && FIELD_INVALID,
              className
            )}
          >
            {options
              ? options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))
              : children}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-500"
          />
        </div>
      </FieldShell>
    );
  }
);
