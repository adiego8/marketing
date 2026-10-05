"use client";

import * as React from "react";
import { FormError } from "@/components/ui/form-error";
import { cn } from "@/lib/utils";

/**
 * The chrome every form control shares: the label, the ids that wire it to its
 * control, the error and the helper text.
 *
 * car-sales-os writes this out three times, once each in Input, Textarea and
 * Select — and its Textarea drifted as a result, missing the `htmlFor` fix the
 * other two have. One module instead, so the three cannot disagree.
 */

export type FieldSize = "sm" | "md";

/** On the Button scale — a field beside a button should match its height. */
export const FIELD_SIZES: Record<FieldSize, string> = {
  sm: "h-8 px-3",
  md: "h-10 px-3",
};

/**
 * Shared control chrome.
 *
 * Note what is absent: `focus:outline-none`. Every `field.*` token used to
 * carry it, and as a class-plus-pseudo-class selector it outranked the bare
 * `:focus-visible` rule in globals.css — so tabbing into a field removed the
 * outline and left only a border-colour change. The global outline is the
 * focus indicator; nothing here may override it, and nothing here should draw
 * a second one either.
 */
export const FIELD_BASE =
  "w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/** The invalid state. Never the only signal — FormError carries the words. */
export const FIELD_INVALID = "border-red-500";

/**
 * Ids for a control and the things that describe it.
 *
 * `useId` rather than a caller-supplied id: before this the app had 32 labels
 * and 4 `htmlFor` attributes, so 28 controls were announced as unlabelled and
 * clicking their label did nothing. An explicit `id` from the caller still
 * wins.
 */
export function useFieldIds(
  explicitId: string | undefined,
  error?: string,
  helperText?: string
) {
  const generated = React.useId();
  const id = explicitId ?? generated;
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  return {
    id,
    errorId,
    helperId,
    describedBy: error ? errorId : helperText ? helperId : undefined,
  };
}

/**
 * The label. Uppercase 12px — this app's established treatment across ~39
 * fields, and the one car-sales-os's SectionHeading reserves for "field
 * descriptors". slate-500 rather than slate-400, which measured 2.56:1 on
 * white and failed AA.
 */
export function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs uppercase tracking-wide text-slate-500"
    >
      {children}
      {required && <span className="ml-1 text-red-600">*</span>}
    </label>
  );
}

/** Label, control, error, helper — assembled in that order, every time. */
export function FieldShell({
  label,
  id,
  required,
  error,
  errorId,
  helperText,
  helperId,
  className,
  children,
}: {
  label?: string;
  id: string;
  required?: boolean;
  error?: string;
  errorId: string;
  helperText?: string;
  helperId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("w-full", className)}>
      {label && (
        <FieldLabel htmlFor={id} required={required}>
          {label}
        </FieldLabel>
      )}
      {children}
      <FormError id={errorId}>{error}</FormError>
      {/* Helper text is suppressed while an error shows: two lines of guidance
          under one control is noise, and the error is the one that matters. */}
      {helperText && !error && (
        <p id={helperId} className="mt-1.5 text-xs text-slate-500">
          {helperText}
        </p>
      )}
    </div>
  );
}
