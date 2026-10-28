"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";
import { usePortalScope } from "./portal-scope";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => {
  const container = usePortalScope();
  return (
    <TooltipPrimitive.Portal container={container ?? undefined}>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-[10150] overflow-hidden rounded-xl border border-border bg-popover px-3 py-1.5 text-xs font-semibold text-popover-foreground shadow-card whitespace-nowrap",
          "animate-in fade-in-0 zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          "will-change-[transform,opacity] origin-(--radix-tooltip-content-transform-origin)",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
interface SystemTooltipProps extends Omit<
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
  "content"
> {
  content: React.ReactNode;
  children: React.ReactNode;
  delayDuration?: number;
}

const SystemTooltip = ({
  content,
  children,
  delayDuration = 150,
  side = "top",
  ...props
}: SystemTooltipProps) => {
  const [open, setOpen] = React.useState(false);

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (
      nextOpen &&
      typeof document !== "undefined" &&
      document.body?.dataset?.crmInteracting === "true"
    ) {
      setOpen(false);
      return;
    }
    setOpen(nextOpen);
  }, []);

  if (!content) return <>{children}</>;
  return (
    <Tooltip
      open={open}
      onOpenChange={handleOpenChange}
      delayDuration={delayDuration}
      disableHoverableContent
    >
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      {open ? (
        <TooltipContent side={side} {...props}>
          {content}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
};

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, SystemTooltip };
