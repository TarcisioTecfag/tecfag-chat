import React from "react";
import { AVATAR_URL } from "../../config";

export const TypingIndicator: React.FC = () => {
  return (
    <div className="flex w-full justify-start mb-4 message-enter">
      <div className="flex max-w-[85%] flex-row items-end gap-2.5">
        <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 mb-1 shadow-md border-2 border-[#E50914]">
          <img
            src={AVATAR_URL}
            alt="Fagner"
            className="w-full h-full object-cover"
          />
        </div>
        <div className="px-4 py-3.5 rounded-2xl bg-white border border-slate-100 rounded-bl-sm shadow-sm flex items-center gap-1.5 h-[42px]">
          <span className="w-1.5 h-1.5 bg-[#E50914] rounded-full animate-bounce [animation-delay:-0.3s]"></span>
          <span className="w-1.5 h-1.5 bg-[#E50914] rounded-full animate-bounce [animation-delay:-0.15s]"></span>
          <span className="w-1.5 h-1.5 bg-[#E50914] rounded-full animate-bounce"></span>
        </div>
      </div>
    </div>
  );
};
