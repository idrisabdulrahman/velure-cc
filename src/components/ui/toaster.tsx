"use client";

import { Icons } from "./icons";
import { Progress } from "./progress";
import { Spinner } from "./spinner";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./toast";
import { useToast } from "./use-toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, progress = 0, action, footer, ...props }) => {
        return (
          <Toast key={id} {...props} className="flex flex-col">
            <div className="flex w-full">
              <div className="space-y-2 w-full justify-center">
                <div className="flex space-x-2 justify-between">
                  <div className="flex space-x-2 items-center">
                    {props?.variant && (
                      <div className="w-[20px] h-[20px] flex items-center">
                        {props.variant === "ai" && <Icons.AI className="text-[#7BC4FF]" />}
                        {props?.variant === "success" && <Icons.Check className="text-[#C8FF1A]" />}
                        {props?.variant === "error" && <Icons.Error className="text-[#FF5B65]" />}
                        {props?.variant === "progress" && (
                          <Spinner className="h-4 w-4 animate-spin !stroke-[#A3AEBD]" />
                        )}
                        {props?.variant === "spinner" && (
                          <Spinner className="h-4 w-4 animate-spin !stroke-[#A3AEBD]" />
                        )}
                      </div>
                    )}
                    <div>{title && <ToastTitle>{title}</ToastTitle>}</div>
                  </div>

                  <div>
                    {props?.variant === "progress" && (
                      <span className="text-sm text-[#8D97A5]">{progress}%</span>
                    )}
                  </div>
                </div>

                {props.variant === "progress" && (
                  <Progress
                    value={progress}
                    className="h-[3px] w-full rounded-none bg-[#1A1D22] [&>div]:bg-[#C8FF1A] [&>div]:transition-transform [&>div]:duration-500 [&>div]:ease-out"
                  />
                )}

                {description && <ToastDescription>{description}</ToastDescription>}
              </div>
              {action}
              <ToastClose />
            </div>

            <div className="w-full flex justify-end">{footer}</div>
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
