import * as React from "react";
import { cn } from "../../utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    const numberInputClassName =
      type === "number"
        ? "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        : "";

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full border bg-transparent px-3 py-1 text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 autofill:[-webkit-text-fill-color:currentColor] [&:-webkit-autofill]:!bg-transparent [&:-webkit-autofill]:!bg-none [&:-webkit-autofill]:!shadow-[inset_0_0_0px_1000px_transparent] [&:-webkit-autofill]:[-webkit-text-fill-color:currentColor] [&:-webkit-autofill]:[transition:background-color_9999s_ease-out,color_9999s_ease-out]",
          numberInputClassName,
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
