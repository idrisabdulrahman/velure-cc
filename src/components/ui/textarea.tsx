import * as React from "react";
import { cn } from "../../utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(183,242,86,0.35)] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
