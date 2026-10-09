"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // Design consistente com o tooltip manual dos módulos da sidebar:
        // fundo foreground (preto no light / branco no dark), texto inverso
        "z-[9999] overflow-hidden rounded-xl bg-foreground px-3 py-1.5 text-xs font-semibold text-background shadow-lg whitespace-nowrap",
        "animate-in fade-in-0 zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        "will-change-[transform,opacity] origin-(--radix-tooltip-content-transform-origin)",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
interface SystemTooltipProps extends Omit<React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>, "content"> {
  content: React.ReactNode;
  children: React.ReactNode;
  delayDuration?: number;
}

const SystemTooltip = ({ content, children, delayDuration = 150, side = "top", ...props }: SystemTooltipProps) => {
  if (!content) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} {...props}>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, SystemTooltip };

