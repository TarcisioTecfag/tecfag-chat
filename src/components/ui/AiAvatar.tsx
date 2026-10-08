import React, { useState } from "react";
import { getAiPersona } from "@/lib/ai-persona";
import { cn } from "@/lib/utils";

export interface AiAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  tenantId?: string;
  className?: string;
  imgClassName?: string;
  alt?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * AiAvatar
 * Renderiza o avatar oficial da IA de acordo com o tenant informado (Fagner no tecfag, Valentina no valem).
 * No tenant tecfag, alterna instantaneamente entre a foto de tema claro e tema escuro via Tailwind CSS (dark:).
 */
export function AiAvatar({
  tenantId = "valem",
  className = "h-8 w-8 rounded-full border border-border shadow-xs",
  imgClassName = "",
  alt,
  onClick,
  ...props
}: AiAvatarProps) {
  const persona = getAiPersona(tenantId);
  const [hasError, setHasError] = useState(false);
  const isTecfag = tenantId === "tecfag";

  if (hasError) {
    return (
      <div
        className={cn(
          "relative flex items-center justify-center shrink-0 overflow-hidden bg-primary/10 border border-primary/20 font-bold text-xs text-primary",
          className
        )}
        onClick={onClick}
        {...props}
      >
        {persona.name.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  if (isTecfag && persona.avatarLightUrl && persona.avatarDarkUrl) {
    return (
      <div
        className={cn("relative shrink-0 overflow-hidden select-none", className)}
        onClick={onClick}
        {...props}
      >
        <img
          src={persona.avatarLightUrl}
          alt={alt || `${persona.name} IA`}
          onError={() => setHasError(true)}
          className={cn("h-full w-full object-cover dark:hidden", imgClassName)}
        />
        <img
          src={persona.avatarDarkUrl}
          alt={alt || `${persona.name} IA`}
          onError={() => setHasError(true)}
          className={cn("h-full w-full object-cover hidden dark:block", imgClassName)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden select-none", className)}
      onClick={onClick}
      {...props}
    >
      <img
        src={persona.avatarUrl}
        alt={alt || `${persona.name} IA`}
        onError={() => setHasError(true)}
        className={cn("h-full w-full object-cover", imgClassName)}
      />
    </div>
  );
}
