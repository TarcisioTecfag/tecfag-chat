import React from "react";
import { Toaster as Sonner } from "sonner";
import { CheckCircle2, Info, AlertTriangle, AlertCircle, Loader2 } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ position = "top-right", ...props }: ToasterProps) => {
  const { isDark } = useTheme();

  return (
    <Sonner
      theme={isDark ? "dark" : "light"}
      position={position}
      offset={16}
      gap={10}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-xl)",
        } as React.CSSProperties
      }
      icons={{
        success: <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />,
        info: <Info className="h-4 w-4 text-primary shrink-0" />,
        warning: <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />,
        error: <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />,
        loading: <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast !bg-card/95 !backdrop-blur-xl !text-foreground !border !border-border !shadow-card !rounded-2xl !px-4 !py-3.5 !gap-3 !items-start",
          title: "!text-xs !font-bold !text-foreground !leading-snug",
          description: "!text-[11px] !text-muted-foreground !leading-relaxed !mt-0.5",
          icon: "!mt-0.5 !mr-0 !shrink-0",
          actionButton:
            "!bg-primary hover:!bg-primary/90 !text-primary-foreground !text-[11px] !font-semibold !px-3 !py-1.5 !rounded-lg !h-auto !shadow-2xs !transition !cursor-pointer !shrink-0 !self-center",
          cancelButton:
            "!bg-muted hover:!bg-muted/80 !text-muted-foreground !text-[11px] !font-semibold !px-2.5 !py-1.5 !rounded-lg !h-auto !cursor-pointer",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

