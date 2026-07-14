import React, { useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { Eye, EyeOff, Camera } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

export function Login() {
  const { login } = useChat();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Determinar dinamicamente o inquilino com base no texto do email para mudar o tema de cores
  const isValem = email.toLowerCase().includes("valem");
  const activeTenant = isValem ? "valem" : "tecfag";

  // Estilos de tema dinâmicos para harmonia de cores
  const themeStyles = activeTenant === "tecfag"
    ? ({
        "--primary": "#df3d3d", // Vermelho Tecfag
        "--primary-soft": "#fde8e8",
        "--primary-hover": "#c83232",
      } as React.CSSProperties)
    : ({
        "--primary": "#2dc4a0", // Verde Esmeralda Valem
        "--primary-soft": "#d8f1ea",
        "--primary-hover": "#24a383",
      } as React.CSSProperties);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Por favor, preencha todos os campos.");
      return;
    }

    setIsLoading(true);
    try {
      const success = await login(email, password);
      if (success) {
        toast.success("Login efetuado com sucesso!");
      } else {
        toast.error("Credenciais inválidas. Tente novamente.");
      }
    } catch (err) {
      toast.error("Ocorreu um erro ao tentar entrar.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    toast.info("A integração de login com o Google está em modo de demonstração.");
  };

  const panelTransition = {
    type: "spring",
    stiffness: 90,
    damping: 17,
    mass: 1.1
  };

  return (
    <div
      className="min-h-screen w-full bg-background flex flex-col md:grid md:grid-cols-5 text-foreground transition-all duration-500 select-none font-sans"
      style={themeStyles}
    >
      {/* PAINEL DA ESQUERDA: Espaço para Foto & Citação */}
      <motion.div
        layout
        transition={panelTransition}
        className={`relative md:col-span-2 flex flex-col justify-between p-8 md:p-12 overflow-hidden min-h-[400px] md:min-h-screen bg-slate-950 text-white ${
          isValem ? "order-2 md:order-2" : "order-1 md:order-1"
        }`}
      >
        {/* Fundo com a foto do Tecfag */}
        <div 
          className={`absolute inset-0 z-0 bg-cover bg-center transition-all duration-1000 ease-out ${
            activeTenant === "tecfag" ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-105 blur-[2px]"
          }`} 
          style={{ backgroundImage: "url('/bg_login.png')" }} 
        />
        {/* Fundo com a foto do Valem */}
        <div 
          className={`absolute inset-0 z-0 bg-cover bg-center transition-all duration-1000 ease-out ${
            activeTenant === "valem" ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-105 blur-[2px]"
          }`} 
          style={{ backgroundImage: "url('/bg_login_valem.png')" }} 
        />
        {/* Camada de sobreposição escura (overlay) para garantir contraste do texto */}
        <div className="absolute inset-0 z-0 bg-black/40" />

        {/* LOGO SUPERIOR */}
        <div className="relative z-10 flex items-center">
          <div className="flex items-center gap-1.5 mr-3 bg-white/10 p-2 rounded-xl backdrop-blur-md border border-white/10">
            <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="8" cy="8" r="4" />
              <circle cx="16" cy="8" r="4" />
              <circle cx="8" cy="16" r="4" />
              <circle cx="16" cy="16" r="3" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight transition-all duration-500">
            {activeTenant === "tecfag" ? "Tecfag Chat" : "Valem Chat"}
          </span>
        </div>

        {/* CITAÇÃO INFERIOR */}
        <div className="relative z-10 max-w-md mt-auto pt-16 min-h-[160px] flex items-end">
          <div className="relative w-full">
            {/* Citação Tecfag */}
            <div className={`transition-all duration-700 transform ease-out ${
              activeTenant === "tecfag" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none absolute inset-x-0 bottom-0"
            }`}>
              <blockquote className="text-xl md:text-2xl font-medium leading-relaxed tracking-tight mb-6">
                “Simplesmente todas as ferramentas que minha equipe e eu precisamos.”
              </blockquote>
              <div>
                <cite className="not-italic block font-bold text-sm text-white">Gilson Donato</cite>
                <span className="text-xs text-white/60">Chief Executive Officer da Tecfag Group</span>
              </div>
            </div>

            {/* Citação Valem */}
            <div className={`transition-all duration-700 transform ease-out ${
              activeTenant === "valem" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none absolute inset-x-0 bottom-0"
            }`}>
              <blockquote className="text-xl md:text-2xl font-medium leading-relaxed tracking-tight mb-6">
                “Com experiência, vendemos rápido.<br />
                Com estratégia, vendemos muito.”
              </blockquote>
              <div>
                <cite className="not-italic block font-bold text-sm text-white">João Rodolfo Lanza</cite>
                <span className="text-xs text-white/60">Diretor Executivo da Tecfag Group</span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* PAINEL DA DIREITA: Formulário de Login */}
      <motion.div
        layout
        transition={panelTransition}
        className={`md:col-span-3 flex items-center justify-center p-6 sm:p-12 md:p-20 bg-white ${
          isValem ? "order-1 md:order-1" : "order-2 md:order-2"
        }`}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 220 }}
          className="w-full max-w-[420px] flex flex-col"
        >
          
          {/* Cabeçalho */}
          <div className="text-center md:text-left mb-8">
            {/* Logo do Tenant */}
            <div className="relative h-16 w-full mb-6 flex justify-center md:justify-start">
              {/* Logo Tecfag */}
              <img
                src="/logo_tecfag.png"
                alt="Tecfag Logo"
                className={`absolute h-16 w-auto object-contain rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100 bg-white p-2 transition-all duration-700 hover:scale-105 ${
                  activeTenant === "tecfag" ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                }`}
              />
              {/* Logo Valem */}
              <img
                src="/logo_valem.jpg"
                alt="Valem Logo"
                className={`absolute h-16 w-auto object-contain rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100 bg-white p-2 transition-all duration-700 hover:scale-105 ${
                  activeTenant === "valem" ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                }`}
              />
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 mb-2.5">
              Boas-vindas de volta
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Gerencie sua comunicação sem esforço com nossa poderosa plataforma.
            </p>
          </div>

          {/* Formulário */}
          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Input E-mail */}
            <div className="relative border border-slate-200 rounded-xl px-4 py-2.5 bg-white transition-all duration-500 focus-within:border-[var(--primary)] focus-within:ring-2 focus-within:ring-[var(--primary)]/10">
              <label className="block text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-0.5">
                E-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="exemplo@tecfag.com.br"
                required
                disabled={isLoading}
                className="block w-full text-sm text-slate-900 bg-transparent border-0 p-0 focus:ring-0 focus:outline-none placeholder:text-slate-300 transition-all duration-500"
              />
            </div>

            {/* Input Senha */}
            <div className="relative border border-slate-200 rounded-xl px-4 py-2.5 bg-white transition-all duration-500 focus-within:border-[var(--primary)] focus-within:ring-2 focus-within:ring-[var(--primary)]/10">
              <label className="block text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-0.5">
                Senha
              </label>
              <div className="flex items-center">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={isLoading}
                  className="block w-full text-sm text-slate-900 bg-transparent border-0 p-0 focus:ring-0 focus:outline-none placeholder:text-slate-300 transition-all duration-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-slate-400 hover:text-slate-600 focus:outline-none ml-2 transition-colors duration-500"
                >
                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </div>

            {/* Esqueceu a Senha */}
            <div className="text-left py-1">
              <a
                href="https://teams.microsoft.com/l/chat/0/0?users=suporte2@tecfag.com.br&message=Olá,%20preciso%20de%20ajuda%20para%20recuperar%20minha%20senha%20no%20sistema."
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-[var(--primary)] hover:text-[var(--primary-hover)] transition-all duration-500"
              >
                Esqueceu a senha?
              </a>
            </div>

            {/* Lembrar Dados de Acesso */}
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <span className="text-xs text-slate-500 font-medium">Lembrar dados de acesso</span>
              <button
                type="button"
                onClick={() => setRememberMe(!rememberMe)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all duration-500 ease-in-out focus:outline-none ${
                  rememberMe ? "bg-[var(--primary)]" : "bg-slate-200"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-500 ease-in-out ${
                    rememberMe ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Botão Entrar */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-sm font-bold py-3.5 px-4 rounded-2xl shadow-sm transition-all duration-500 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:ring-offset-2 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-6"
            >
              {isLoading ? "Entrando..." : "Entrar"}
            </button>
          </form>

          {/* Divisor OU */}
          <div className="flex items-center my-6">
            <div className="flex-1 h-[1px] bg-slate-100"></div>
            <span className="px-3.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
              ou
            </span>
            <div className="flex-1 h-[1px] bg-slate-100"></div>
          </div>

          {/* Botão Teams */}
          <a
            href="https://teams.microsoft.com/l/chat/0/0?users=suporte2@tecfag.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-3 bg-slate-50 hover:bg-slate-100/80 text-slate-700 text-sm font-bold py-3.5 px-4 rounded-2xl border border-slate-100 transition-all duration-500 focus:outline-none focus:ring-2 focus:ring-slate-200 focus:ring-offset-1 cursor-pointer decoration-none"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" className="text-[#6264A7] transition-colors duration-500" viewBox="0 0 16 16">
              <path d="M9.186 4.797a2.42 2.42 0 1 0-2.86-2.448h1.178c.929 0 1.682.753 1.682 1.682zm-4.295 7.738h2.613c.929 0 1.682-.753 1.682-1.682V5.58h2.783a.7.7 0 0 1 .682.716v4.294a4.197 4.197 0 0 1-4.093 4.293c-1.618-.04-3-.99-3.667-2.35Zm10.737-9.372a1.674 1.674 0 1 1-3.349 0 1.674 1.674 0 0 1 3.349 0m-2.238 9.488-.12-.002a5.2 5.2 0 0 0 .381-2.07V6.306a1.7 1.7 0 0 0-.15-.725h1.792c.39 0 .707.317.707.707v3.765a2.6 2.6 0 0 1-2.598 2.598z"/>
              <path d="M.682 3.349h6.822c.377 0 .682.305.682.682v6.822a.68.68 0 0 1-.682.682H.682A.68.68 0 0 1 0 10.853V4.03c0-.377.305-.682.682-.682Zm5.206 2.596v-.72h-3.59v.72h1.357V9.66h.87V5.945z"/>
            </svg>
            <span>Suporte no Teams</span>
          </a>

          {/* Cadastro */}
          <div className="text-center mt-8">
            <p className="text-xs text-slate-500 font-medium">
              Não tem uma conta?{" "}
              <a
                href="https://teams.microsoft.com/l/chat/0/0?users=suporte2@tecfag.com.br&message=Olá,%20gostaria%20de%20solicitar%20a%20criação%20de%20uma%20conta%20de%20operador%20no%20sistema."
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-[var(--primary)] hover:text-[var(--primary-hover)] transition-all duration-500 ml-1"
              >
                Cadastre-se
              </a>
            </p>
          </div>

        </motion.div>
      </motion.div>
    </div>
  );
}
