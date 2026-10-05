"use client";

import * as React from "react";
import {
  ConfirmDialog,
  type ConfirmDialogProps,
} from "@/components/ui/confirm-dialog";

/**
 * `useConfirm()` — one dialog, awaited like `window.confirm()` used to be.
 *
 *     if (!(await confirm({ title: "Delete this lesson?" }))) return;
 *
 * The promise shape is the point. Every call site in this app was already
 * `if (!confirm(text)) return;` at the top of a handler, so the replacement
 * sits in exactly the same place. The controlled `ConfirmDialog` alone would
 * have meant hoisting open-state into thirteen components and splitting each
 * handler in two — including three that live inside `.map()` callbacks, where
 * there is no single component to hold the state.
 */
export type ConfirmOptions = Omit<
  ConfirmDialogProps,
  "open" | "onConfirm" | "onCancel"
>;

const ConfirmContext = React.createContext<
  ((options: ConfirmOptions) => Promise<boolean>) | null
>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);
  // The pending promise's resolver. A ref rather than state: settling it must
  // not itself schedule a render, and it is read only from event handlers.
  const resolverRef = React.useRef<((answer: boolean) => void) | null>(null);

  const confirm = React.useCallback((next: ConfirmOptions) => {
    // A second request while one is open answers the first as "no" rather than
    // leaving its promise dangling forever. In practice this cannot happen —
    // the dialog is modal — but an unresolved promise would hang a handler.
    resolverRef.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = React.useCallback((answer: boolean) => {
    resolverRef.current?.(answer);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        {...(options ?? { title: "" })}
        open={options !== null}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = React.useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return confirm;
}
