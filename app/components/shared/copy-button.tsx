"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
    // The old `text-xs` override is gone: `sm` is 14px, and a 12px action
    // label was the legibility problem this size exists to avoid.
    <Button
      variant={variant === "ghost" ? "ghost" : "secondary"}
      size="sm"
      onClick={handleCopy}
      className={cn(copied && "text-teal-700", className)}
    >
      {copied ? "Copied!" : label}
    </Button>
  );
}
