import React from "react";
import { motion } from "framer-motion";

export const TypingIndicator: React.FC<{ isBlackNovember?: boolean }> = ({
  isBlackNovember = false,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ type: "spring" as const, stiffness: 400, damping: 25 }}
      className="flex justify-start mb-3"
      style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}
    >
      <div
        className="bg-chat-agent rounded-2xl rounded-bl-md px-4 py-3 shadow-sm flex items-center gap-1"
        style={{
          background: isBlackNovember
            ? "linear-gradient(135deg, #18181b 0%, #27272a 100%)"
            : "#dc2626",
          borderRadius: "16px 16px 16px 6px",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 4,
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}
      >
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-2 h-2 rounded-full bg-primary-foreground/70"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.7)",
              display: "inline-block",
            }}
            animate={{ y: [0, -6, 0] }}
            transition={{
              duration: 0.6,
              repeat: Infinity,
              delay: i * 0.15,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
    </motion.div>
  );
};

export default TypingIndicator;
