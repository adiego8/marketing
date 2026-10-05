"use client";

import * as React from "react";
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
 * A text input. Mirrors car-sales-os/components/ui/Input.tsx's props —
 * `label`, `error`, `helperText` — plus a `size` on the Button scale.
 *
 * Not for `checkbox`, `radio`, `color` or `file`: those want their own
 * geometry, not `h-10 w-full`. They stay as plain elements.
 */
export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: string;
  helperText?: string;
  size?: FieldSize;
  /** Classes for the wrapper rather than the control — widths, mostly. */
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      label,
      error,
      helperText,
      size = "md",
      className,
      wrapperClassName,
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
        <input
          ref={ref}
          {...props}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            FIELD_BASE,
            FIELD_SIZES[size],
            error && FIELD_INVALID,
            className
          )}
        />
      </FieldShell>
    );
  }
);
