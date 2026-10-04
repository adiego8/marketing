"use client";

import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The button. One of them.
 *
 * Same export surface and prop names as car-sales-os/components/ui/Button.tsx —
 * `variant`, `size`, `loading`, `fullWidth`, plus `buttonVariants` — so code and
 * people move between the two products. The machinery underneath is Base UI's
 * button rather than Radix's, which is what this app already depends on.
 *
 * This replaces `lib/ui.ts`'s `btn.*` strings, which had grown five different
 * heights (48 / 40 / 36 / 32 / 28px) and put three of them in a single row on
 * the calendar header. Four sizes now, and one placement rule: header actions
 * are `md`, everything inline is `sm`.
 *
 * Colours are today's values, lifted from the tokens they replace, with two
 * fixes: ghost hovered to `stone-50`, which is the page ground and therefore
 * invisible, and primary hovered to teal-500 — *lighter* than its teal-600
 * rest, dropping white text to about 2.9:1. Both hovers now go darker.
 *
 * `asChild` has no equivalent and needs none: Base UI's `render` is strictly
 * more capable, and a navigation link should take `buttonVariants()` on its
 * className rather than be announced to a screen reader as a button.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-teal-600 text-white hover:bg-teal-700",
        secondary:
          "border border-slate-300 bg-white text-slate-700 hover:border-slate-400",
        ghost: "text-slate-500 hover:bg-stone-100 hover:text-slate-700",
        danger:
          "border border-red-200 text-red-600 hover:bg-red-50",
        link: "text-slate-500 hover:text-teal-700",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-11 px-6 text-base",
        icon: "size-10",
      },
    },
    compoundVariants: [
      // A text link is not a 40px box. cva emits compound classes after the
      // size classes, so twMerge resolves these over `h-10 px-4`.
      { variant: "link", class: "h-auto px-0 font-normal" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends Omit<ButtonPrimitive.Props, "className">,
    VariantProps<typeof buttonVariants > {
  /**
   * Base UI allows `className` to be a function of component state, which
   * `cn()` cannot merge. Narrowed to a string; no caller here needs the
   * callback form.
   */
  className?: string;
  /**
   * Shows a spinner and disables the button. Deliberately does not touch the
   * label: the existing `{saving ? "Saving…" : "Save"}` call sites say it
   * better in words than a spinner does.
   */
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      loading = false,
      fullWidth = false,
      disabled,
      children,
      ...props
    },
    ref
  ) {
    return (
      <ButtonPrimitive
        ref={ref}
        data-slot="button"
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          buttonVariants({ variant, size }),
          fullWidth && "w-full",
          className
        )}
        {...props}
      >
        {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
        {children}
      </ButtonPrimitive>
    );
  }
);

export { buttonVariants };
