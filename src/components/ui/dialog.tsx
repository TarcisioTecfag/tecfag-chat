"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 will-change-[opacity]",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

function isProtectedOutsideTarget(event: any): boolean {
  const candidates: EventTarget[] = [
    event?.target,
    event?.detail?.originalEvent?.target,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate instanceof Element) {
      if (
        candidate.closest(
          "[data-crm-chat-widget], [data-crm-interactive-portal], [data-radix-popper-content-wrapper], [data-sonner-toaster]",
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

let bodyGuardRegistered = false;
export function ensureMiniChatBodyEventGuard() {
  if (bodyGuardRegistered || typeof document === "undefined" || !document.body) return;
  bodyGuardRegistered = true;

  const isProtectedNode = (node: EventTarget | null): boolean => {
    if (!(node instanceof Element)) return false;
    return Boolean(
      node.closest(
        "[data-crm-chat-widget], [data-crm-interactive-portal], [data-radix-popper-content-wrapper]",
      ),
    );
  };

  const stopScrollPropagation = (event: Event) => {
    if (isProtectedNode(event.target)) {
      event.stopPropagation();
    }
  };

  const stopFocusPropagation = (event: FocusEvent) => {
    if (isProtectedNode(event.target) || isProtectedNode(event.relatedTarget)) {
      event.stopPropagation();
    }
  };

  document.body.addEventListener("wheel", stopScrollPropagation, { passive: true });
  document.body.addEventListener("touchmove", stopScrollPropagation, { passive: true });
  document.body.addEventListener("touchstart", stopScrollPropagation, { passive: true });
  document.body.addEventListener("focusin", stopFocusPropagation);
  document.body.addEventListener("focusout", stopFocusPropagation);
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(
  (
    {
      className,
      children,
      onPointerDownOutside,
      onFocusOutside,
      onInteractOutside,
      ...props
    },
    ref,
  ) => {
    React.useEffect(() => {
      ensureMiniChatBodyEventGuard();
    }, []);

    return (
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          onPointerDownOutside={(event) => {
            if (isProtectedOutsideTarget(event)) {
              event.preventDefault();
              return;
            }
            onPointerDownOutside?.(event);
          }}
          onFocusOutside={(event) => {
            if (isProtectedOutsideTarget(event)) {
              event.preventDefault();
              return;
            }
            onFocusOutside?.(event);
          }}
          onInteractOutside={(event) => {
            if (isProtectedOutsideTarget(event)) {
              event.preventDefault();
              return;
            }
            onInteractOutside?.(event);
          }}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 will-change-[transform,opacity] sm:rounded-lg",
            className,
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
