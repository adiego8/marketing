"use client";

import type { ReactNode } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Are you sure?", as a real dialog.
 *
 * Props mirror car-sales-os/components/ui/ConfirmDialog.tsx so the controlled
 * form stays interchangeable between the two products. Most callers here use
 * `useConfirm()` instead — see confirm-provider.tsx.
 *
 * Built on Base UI's alert-dialog rather than its dialog. The role matters for
 * something destructive: `alertdialog` is announced assertively, and it does
 * not dismiss on an outside click, so a stray click cannot answer the question
 * for you. Escape and Cancel still close it, both meaning "no".
 *
 * This replaces thirteen `window.confirm()` calls. The reason was not that they
 * were unstyled: browsers offer "prevent this page from creating additional
 * dialogs" after a few prompts, and a suppressed confirm() returns false. Every
 * site was written `if (!confirm(…)) return;`, so once suppressed, Delete and
 * Revoke silently did nothing at all.
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-slate-900/20 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-5 shadow-lg transition-opacity duration-150 outline-none data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                variant === "danger"
                  ? "bg-red-50 text-red-600"
                  : "bg-teal-50 text-teal-700"
              )}
            >
              {variant === "danger" ? (
                <AlertTriangle className="size-5" />
              ) : (
                <Info className="size-5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <AlertDialog.Title className="text-base font-semibold text-slate-900">
                {title}
              </AlertDialog.Title>
              {message && (
                <AlertDialog.Description
                  render={<div />}
                  className="mt-2 text-sm text-slate-600"
                >
                  {message}
                </AlertDialog.Description>
              )}
            </div>
          </div>
          {/* Cancel first in the DOM so it takes initial focus: the safe answer
              should be the one you get by pressing Enter without reading. The
              visual order is reversed back on wider screens. */}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" size="md" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              variant={variant === "danger" ? "danger" : "primary"}
              size="md"
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
