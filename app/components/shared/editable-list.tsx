"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EditableListProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}

export function EditableList({ items, onChange, placeholder = "Add item…" }: EditableListProps) {
  const [newItem, setNewItem] = useState("");

  const handleAdd = () => {
    if (!newItem.trim()) return;
    onChange([...items, newItem.trim()]);
    setNewItem("");
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-700 text-xs font-medium pl-3 pr-2 py-1"
            >
              {item}
              <button
                type="button"
                onClick={() => handleRemove(i)}
                aria-label={`Remove ${item}`}
                className="text-slate-500 hover:text-red-600 transition-colors leading-none"
              >
                &#215;
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          size="sm"
          aria-label={placeholder ?? "Add an item"}
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        <Button variant="secondary" size="sm" className="shrink-0" type="button" onClick={handleAdd}>
          Add
        </Button>
      </div>
    </div>
  );
}
