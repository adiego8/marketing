"use client";

import { useState } from "react";
import { btn } from "@/lib/ui";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  label?: string;
  /** "secondary" is retained for the orphaned pages; it renders as outline. */
  variant?: "outline" | "ghost" | "secondary";
  className?: string;
}

export function CopyButton({
  text,
  label = "Copy",
  variant = "ghost",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        variant === "ghost" ? btn.ghost : btn.outlineSm,
        "text-xs",
        copied && "text-teal-700",
        className
      )}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
