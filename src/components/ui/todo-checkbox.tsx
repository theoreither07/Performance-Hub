"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { celebrate } from "@/lib/utils/celebrate";

type CheckboxRootProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

interface TodoCheckboxProps extends Omit<CheckboxRootProps, "onCheckedChange" | "onToggle"> {
  onCheck?: (checked: boolean) => void;
}

export const TodoCheckbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  TodoCheckboxProps
>(({ className, checked, onCheck, ...props }, ref) => {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!checked) {
      const rect = e.currentTarget.getBoundingClientRect();
      celebrate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    onCheck?.(!checked);
  };

  return (
    <CheckboxPrimitive.Root
      ref={ref}
      checked={checked}
      onClick={handleClick}
      className={cn(
        "peer h-5 w-5 shrink-0 rounded-md border border-input ring-offset-background",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary",
        "transition-all duration-200 active:scale-90",
        "data-[state=checked]:animate-checkbox-pop",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="h-3.5 w-3.5 animate-check-draw" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
TodoCheckbox.displayName = "TodoCheckbox";
