import React, { useState, useRef, useCallback } from 'react';
import { X, Download } from 'lucide-react';

interface ZoomableImageModalProps {
  url: string;
  onClose: () => void;
}

export function ZoomableImageModal({ url, onClose }: ZoomableImageModalProps) {
  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState({ x: '50%', y: '50%' });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const zoomFactor = 1.1;
    const delta = e.deltaY > 0 ? -1 : 1;
    const newScale = Math.min(Math.max(scale * (delta > 0 ? zoomFactor : 1 / zoomFactor), 1), 5);

    if (newScale !== scale) {
      setOrigin({ x: `${x}%`, y: `${y}%` });
      setScale(newScale);
    }
  }, [scale]);

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm cursor-zoom-out"
      onClick={onClose}
    >
      <button 
        className="absolute top-4 right-4 p-2 bg-zinc-800/80 text-white rounded-full hover:bg-zinc-700 transition-colors z-[201]"
        onClick={onClose}
      >
        <X className="h-6 w-6" />
      </button>

      <div 
        ref={containerRef}
        className="w-full h-full flex items-center justify-center overflow-hidden"
        onWheel={handleWheel}
        onClick={(e) => e.stopPropagation()}
      >
        <img 
          src={url} 
          alt="Zoomable" 
          className="max-w-full max-h-full object-contain transition-transform duration-100 ease-out"
          style={{ 
            transform: `scale(${scale})`,
            transformOrigin: `${origin.x} ${origin.y}`
          }}
        />
      </div>

      <div className="absolute bottom-4 left-0 right-0 flex justify-center z-[201]">
        <a
          href={url}
          download
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/10 backdrop-blur-xs transition-all hover:scale-102 active:scale-98 cursor-pointer shadow-soft"
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="h-4 w-4" />
          <span>Baixar Imagem</span>
        </a>
      </div>
    </div>
  );
}
