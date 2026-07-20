import React, { useState, useRef, useEffect } from "react";
import { Search, Plus, Trash2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

const EMOJI_CATEGORIES = [
  {
    label: "😀",
    name: "Rostos",
    emojis: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","☺️","😚","😙","😙","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐","😕","😟","🙁","☹️","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","☠️","💩","🤡","👹","👺","👻","👽","👾","🤖"],
  },
  {
    label: "👋",
    name: "Gestos",
    emojis: ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍️","💅","🤳","💪","🦵","🦶","👂","🦻","👃","👁️","👀","🫀","🫁","🧠","🦷","🦴","👄","👅","💋","🫦"],
  },
  {
    label: "❤️",
    name: "Símbolos",
    emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","☮️","✝️","☪️","🕉️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","🉑","☢️","☣️","📴","📳","🈶","🈚","🈸","🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️","🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑","🅾️","🆘","❌","⭕","🛑","⛔","📛","🚫","💯","💢","♨️","🚷","🚯","🚳","🚱","🔞","📵","🚭","❗","❕","❓","❔","‼️","⁉️","🔅","🔆","〽️","⚠️","🚸","🔱","⚜️","🔰","♻️","✅","🈯","💹","❎","🌐","💠","Ⓜ️","🌀","💤","🏧","🚾","♿","🅿️","🈳","🈂️","🛂","🛃","🛄","🛅","🚹","🚺","🚼","⚧️","🚻","🚮","🎦","📶","🈁","🔣","ℹ️","🔤","🔡","🔠","🆖","🆗","🆙","🆒","🆕","🆓","0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟","🔢","#️⃣","*️⃣","⏏️","▶️","⏸️","⏹️","⏺️","⏭️","⏮️","⏩","⏪","⏫","⏬","◀️","🔼","🔽","➡️","⬅️","⬆️","⬇️","↗️","↘️","↙️","↖️","↕️","↔️","↪️","↩️","⤴️","⤵️","🔀","🔁","🔂","🔃","🎵","🎶","➕","➖","➗","✖️","♾️","💲","💱","™️","©️","®️","〰️","➰","➿","🔚","🔙","🔛","🔝","🔜","✔️","☑️","🔘","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","🔺","🔻","🔸","🔹","🔶","🔷","🔳","🔲","▪️","▫️","◾","◽","◼️","◻️","🟥","🟧","🟨","🟩","🟦","🟪","⬛","⬜","🟫","🔈","🔇","🔉","🔊","🔔","🔕","📣","📢","💬","💭","🗯️","♠️","♣️","♥️","♦️","🃏","🎴","🀄"],
  },
  {
    label: "🐶",
    name: "Animais",
    emojis: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🦟","🦗","🪲","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🦧","🦣","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🦬","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐕‍🦺","🐈","🐈‍⬛","🪶","🐓","🦃","🦤","🦚","🦜","swan","🕊️","🐇","🦝","🦨","🦡","🦫","🦦","🦥","🐁","🐀","🐿️","🦔","🐾","🐉","🐲","🌵","🎄","🌲","🌳","🌴","🌱","🌿","☘️","🍀","🎍","🎋","🍃","🍂","🍁","🍄","🐚","🌾","💐","🌷","🌹","🥀","🌺","🌸","🌼","🌻","🌞","🌝","🌛","🌜","🌚","🌕","🌖","🌗","🌘","🌑","🌒","🌓","🌔","🌙","🌎","🌍","🌏","🪐","💫","⭐","🌟","✨","⚡","☄️","💥","🔥","🌪️","🌈","☀️","🌤️","⛅","🌥️","☁️","🌦️","🌧️","⛈️","🌩️","🌨️","❄️","☃️","⛄","🌬️","💨","💧","💦","🌊"],
  },
  {
    label: "🍔",
    name: "Comida",
    emojis: ["🍇","🍈","🍉","🍊","🍋","🍌","🍍","🥭","🍎","🍏","🍐","🍑","🍒","🍓","🫐","🥝","🍅","🫒","🥥","🥑","🍆","🥔","🥕","🌽","🌶️","🫑","🥒","🥬","🥦","🧄","🧅","🍄","🥜","🌰","🍞","🥐","🥖","🫓","🥨","🥯","🥞","🧇","🧈","🍳","🍲","🥘","🥗","🫕","🫙","🧂","🧀","🌭","🍔","🍟","🍕","taco","🌯","🫔","🥙","🧆","🥚","🍿","🧂","🥓","🥩","🍗","🍖","🍠","🥟","🥠","🥡","🍱","🍘","🍙","🍚","🍛","🍜","🍝","🍣","🍤","🍙","🍚","🍛","🥮","🍡","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🍼","🥛","☕","🫖","🍵","🧃","🥤","🧋","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾","🧊","🥄","🍴","🍽️","🥢","🧊"],
  },
  {
    label: "⚽",
    name: "Esportes",
    emojis: ["⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🏓","🏸","🏒","🏑","🥍","🏏","🪃","🥅","⛳","🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️","🥌","🎿","⛷️","🏂","🪂","🏋️","🤼","🤸","⛹️","fencing","🏊","🚴","🏄","🧗","🏇","🚵","🤾","🏌️","🏃","🚶","🧍","🧎","👩‍🦯","👨‍🦯","👩‍🦼","👨‍🦼","👩‍🦽","👨‍🦽","🏆","🥇","🥈","🥉","🏅","🎖️","🎗️","🎫","🎟️","🎪","🤹","🎭","🩰","🎨","🎬","🎤","🎧","🎼","🎵","🎶","🥁","🪘","🎷","🎺","🎸","🪕","🎻","🎲","♟️","🎯","🎳","🎮","🎰","🧩"],
  },
  {
    label: "🚗",
    name: "Viagem",
    emojis: ["🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🏍️","🛵","🛺","🚲","🛴","🛹","🛼","🚏","🛣️","🛤️","⛽","🚨","🚥","🚦","🛑","🚧","⚓","🛟","⛵","🚤","🛥️","🛳️","⛴️","🚢","✈️","🛩️","🛫","🛬","🪂","💺","🚁","🚟","🚠","🚡","🛰️","🚀","🛸","🛖","🏠","🏡","🏢","🏣","🏤","🏥","🏦","🏨","🏩","🏪","🏫","🏭","🏗️","🧱","🪨","🪵","⛪","🕌","🛕"," synagogues","⛩️","🕋","⛲","⛺","🏕️","🏖️","🏜️","🏝️","🏞️","Stadium","🏛️","🏗️","🌁","🌃","🏙️","🌄","🌅","🌆","🌇","🌉","♨️","🎠","🎡","🎢","💈","🎪"],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  onSelectSticker?: (url: string) => void;
}

export function EmojiPicker({ onSelect, onClose, onSelectSticker }: EmojiPickerProps) {
  const [activeTab, setActiveTab] = useState<"emojis" | "stickers">("emojis");
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(0);
  const [savedStickers, setSavedStickers] = useState<{ id: string; url: string }[]>([]);
  const [converting, setConverting] = useState(false);
  
  const pickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carregar figurinhas salvas no localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("saved_stickers");
      if (saved) {
        setSavedStickers(JSON.parse(saved));
      }
    } catch (err) {
      console.error("Erro ao carregar figurinhas salvas:", err);
    }
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = query
    ? EMOJI_CATEGORIES.flatMap((c) => c.emojis).filter((e) =>
        e.includes(query)
      )
    : EMOJI_CATEGORIES[activeCategory].emojis;

  const handleDeleteSticker = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const updated = savedStickers.filter((item) => item.id !== id);
      setSavedStickers(updated);
      localStorage.setItem("saved_stickers", JSON.stringify(updated));
    } catch (err) {
      console.error("Erro ao excluir figurinha:", err);
    }
  };

  const convertToWebp = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 512;
          canvas.height = 512;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas context not available"));
            return;
          }
          
          const scale = Math.min(512 / img.width, 512 / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          const x = (512 - w) / 2;
          const y = (512 - h) / 2;
          
          ctx.clearRect(0, 0, 512, 512);
          ctx.drawImage(img, x, y, w, h);
          
          try {
            const webpData = canvas.toDataURL("image/webp", 0.8);
            resolve(webpData);
          } catch (err) {
            resolve(canvas.toDataURL("image/png"));
          }
        };
        img.onerror = () => reject(new Error("Erro ao carregar imagem"));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
      reader.readAsDataURL(file);
    });
  };

  const handleImportSticker = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setConverting(true);
    try {
      const webpBase64 = await convertToWebp(file);
      const newSticker = {
        id: `custom-${Date.now()}`,
        url: webpBase64,
      };
      const updated = [...savedStickers, newSticker];
      setSavedStickers(updated);
      localStorage.setItem("saved_stickers", JSON.stringify(updated));
    } catch (err) {
      console.error("Erro ao processar imagem:", err);
    } finally {
      setConverting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <motion.div
      ref={pickerRef}
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ type: "spring", damping: 20, stiffness: 300 }}
      className="absolute bottom-full left-0 mb-2 z-50 w-80 rounded-2xl bg-card border border-border shadow-card overflow-hidden flex flex-col"
      style={{ maxHeight: "360px" }}
    >
      {/* Seletor de Abas */}
      <div className="flex border-b border-border text-xs font-semibold select-none bg-muted/30">
        <button
          onClick={() => setActiveTab("emojis")}
          className={`flex-1 py-2.5 text-center border-b-2 transition cursor-pointer ${
            activeTab === "emojis"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Emojis
        </button>
        <button
          onClick={() => setActiveTab("stickers")}
          className={`flex-1 py-2.5 text-center border-b-2 transition cursor-pointer ${
            activeTab === "stickers"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Figurinhas
        </button>
      </div>

      {activeTab === "emojis" ? (
        <>
          {/* Busca */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              placeholder="Buscar emoji..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>

          {/* Abas de Categorias */}
          {!query && (
            <div className="flex border-b border-border px-1 overflow-x-auto scrollbar-none">
              {EMOJI_CATEGORIES.map((cat, i) => (
                <button
                  key={cat.name}
                  onClick={() => setActiveCategory(i)}
                  title={cat.name}
                  className={`shrink-0 px-2.5 py-2 text-base transition hover:bg-muted rounded-lg ${
                    activeCategory === i ? "bg-muted" : ""
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}

          {/* Grid de Emojis */}
          <div className="grid grid-cols-9 gap-0.5 p-2 max-h-52 overflow-y-auto scrollbar-thin">
            {filtered.map((emoji, i) => (
              <button
                key={i}
                onClick={() => onSelect(emoji)}
                className="flex items-center justify-center h-8 w-8 text-lg rounded-lg hover:bg-muted transition cursor-pointer"
              >
                {emoji}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-9 py-6 text-center text-xs text-muted-foreground">
                Nenhum emoji encontrado
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col flex-1 p-2 max-h-72 overflow-y-auto scrollbar-thin">
          {/* Ações / Cabeçalho */}
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[11px] text-muted-foreground font-medium">
              Figurinhas Salvas ({savedStickers.length})
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={converting}
              className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer disabled:opacity-50"
            >
              {converting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              Importar
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImportSticker}
            />
          </div>

          {/* Grid de Figurinhas */}
          <div className="grid grid-cols-4 gap-2 p-1">
            {savedStickers.map((sticker) => (
              <div
                key={sticker.id}
                onClick={() => onSelectSticker?.(sticker.url)}
                className="relative group aspect-square flex items-center justify-center border border-border bg-muted/40 hover:bg-muted/80 rounded-xl cursor-pointer p-1.5 transition overflow-hidden"
              >
                <img
                  src={sticker.url}
                  alt="Figurinha"
                  className="max-h-full max-w-full object-contain"
                />
                <button
                  onClick={(e) => handleDeleteSticker(e, sticker.id)}
                  className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-red-500 rounded-full text-white opacity-0 group-hover:opacity-100 transition-all duration-150 shadow-sm cursor-pointer"
                  title="Excluir figurinha"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}

            {savedStickers.length === 0 && (
              <div className="col-span-4 py-8 text-center text-xs text-muted-foreground">
                <p>Nenhuma figurinha salva ainda.</p>
                <p className="text-[10px] mt-1">Clique na estrela (⭐) de uma figurinha no chat para salvá-la!</p>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
