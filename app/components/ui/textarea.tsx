"use client";

import * as React from "react";
import {
  FIELD_BASE,
  FIELD_INVALID,
  FieldShell,
  useFieldIds,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * A multi-line input.
 *
 * No `size`: a textarea's height is its content, not a scale step. Callers set
 * rows or a height class; `min-h-20` is the floor.
 *
 * Unlike car-sales-os's Textarea, this one wires `htmlFor` / `id` like its
 * siblings — theirs renders a bare `<label>`, which is the same "label as
 * decoration" bug their own Input.tsx exists to fix.
 */
export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  /** Classes for the wrapper rather than the control. */
  wrapperClassName?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, error, helperText, className, wrapperClassName, ...props },
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
        <textarea
          ref={ref}
          {...props}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            FIELD_BASE,
            "min-h-20 resize-y px-3 py-2",
            error && FIELD_INVALID,
            className
          )}
        />
      </FieldShell>
    );
  }
);
