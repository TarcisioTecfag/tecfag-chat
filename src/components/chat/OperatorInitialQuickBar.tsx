import React, { useState } from "react";
import { normalizeInitialLetter } from "@/lib/operator-initial-navigation";

export interface OperatorInitialMatchMeta {
  letter: string;
  position: number;
  total: number;
}

interface OperatorInitialQuickBarProps {
  initials: string[];
  activeLetter?: string | null;
  matchMeta?: OperatorInitialMatchMeta | null;
  onSelectLetter: (letter: string) => void;
  compact?: boolean;
  showConfirmHint?: boolean;
}

/**
 * Barra rápida de iniciais A-Z para saltar/alternar entre operadores pela letra inicial
 * (tanto clicando na letra quanto pressionando a tecla correspondente no teclado).
 */
export const OperatorInitialQuickBar: React.FC<OperatorInitialQuickBarProps> = ({
  initials,
  activeLetter = null,
  matchMeta = null,
  onSelectLetter,
  compact = false,
  showConfirmHint = true,
}) => {
  if (!initials || initials.length === 0) return null;

  const normalizedActive = activeLetter ? normalizeInitialLetter(activeLetter) : "";
  const activeMeta =
    matchMeta && normalizeInitialLetter(matchMeta.letter) === normalizedActive
      ? matchMeta
      : null;

  return (
    <div
      className={`${compact ? "px-2 py-1" : "px-2.5 py-1.5"} rounded-lg bg-muted/35 border border-border/60 space-y-1 select-none`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-1.5 text-[9px] text-muted-foreground">
        <span className="font-bold uppercase tracking-wider truncate">
          {activeMeta
            ? `Letra ${activeMeta.letter} · ${activeMeta.position}/${activeMeta.total}`
            : "Ir pela inicial (clique ou tecle)"}
        </span>
        {activeMeta && showConfirmHint && (
          <span className="text-[9px] font-semibold text-primary shrink-0">
            {activeMeta.total > 1 ? `Repita ${activeMeta.letter} p/ próximo` : "Enter transfere"}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {initials.map((letter) => {
          const isActive = normalizedActive === letter;
          return (
            <button
              key={letter}
              type="button"
              aria-label={`Selecionar próximo operador com inicial ${letter}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onSelectLetter(letter);
              }}
              className={`h-5 min-w-5 px-1 rounded-md text-[10px] font-extrabold leading-none inline-flex items-center justify-center transition cursor-pointer ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-2xs ring-1 ring-primary/40"
                  : "bg-card hover:bg-primary/15 text-foreground hover:text-primary border border-border/80"
              }`}
            >
              {letter}
            </button>
          );
        })}
      </div>
    </div>
  );
};

interface OperatorAvatarWithInitialProps {
  name: string;
  avatar?: string | null;
  sizeClassName?: string;
  highlighted?: boolean;
}

/**
 * Renderiza o avatar do operador ou um selo circular limpo com sua letra inicial
 * quando não há imagem cadastrada ou a imagem falha ao carregar.
 */
export const OperatorAvatarWithInitial: React.FC<OperatorAvatarWithInitialProps> = ({
  name,
  avatar,
  sizeClassName = "h-6 w-6 text-[10px]",
  highlighted = false,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const initial = normalizeInitialLetter(name) || "?";
  const hasValidAvatar = Boolean(avatar && String(avatar).trim() && !imgFailed);

  if (hasValidAvatar) {
    return (
      <img
        src={String(avatar)}
        alt={name}
        onError={() => setImgFailed(true)}
        className={`${sizeClassName} rounded-full object-cover shrink-0 border ${
          highlighted ? "border-primary ring-1 ring-primary/40" : "border-border"
        }`}
      />
    );
  }

  return (
    <div
      className={`${sizeClassName} rounded-full grid place-items-center font-extrabold uppercase shrink-0 border ${
        highlighted
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-primary/10 text-primary border-primary/20"
      }`}
    >
      {initial}
    </div>
  );
};
