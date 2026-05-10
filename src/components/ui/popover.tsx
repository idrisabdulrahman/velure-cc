"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";
import { cn } from "../../utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    portal?: boolean;
  }
>(({ className, align = "center", sideOffset = 4, portal = true, ...props }, ref) => {
  const content = (
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 border bg-background p-4 text-popover-foreground shadow-md outline-none transition-[transform,opacity,background-color,border-color,color] data-[state=open]:opacity-100 data-[state=closed]:opacity-0 data-[state=open]:duration-[220ms] data-[state=closed]:duration-[180ms] data-[state=open]:ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:ease-out data-[side=bottom]:data-[state=open]:translate-y-0 data-[side=bottom]:data-[state=closed]:translate-y-[-8px] data-[side=top]:data-[state=open]:translate-y-0 data-[side=top]:data-[state=closed]:translate-y-[8px] data-[side=left]:data-[state=open]:translate-x-0 data-[side=left]:data-[state=closed]:translate-x-[8px] data-[side=right]:data-[state=open]:translate-x-0 data-[side=right]:data-[state=closed]:translate-x-[-8px]",
        className,
      )}
      {...props}
    />
  );

  return portal ? <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal> : content;
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
