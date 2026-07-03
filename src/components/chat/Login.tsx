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

  return (
    <div
      className="min-h-screen w-full bg-background flex flex-col md:grid md:grid-cols-5 text-foreground transition-all duration-300 select-none font-sans"
      style={themeStyles}
    >
      {/* PAINEL DA ESQUERDA: Espaço para Foto & Citação */}
      <div className="relative md:col-span-2 flex flex-col justify-between p-8 md:p-12 overflow-hidden min-h-[400px] md:min-h-screen bg-slate-950 text-white">
        {/* Fundo com a foto carregada */}
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-500" 
          style={{ backgroundImage: "url('/bg_login.png')" }} 
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
          <span className="text-lg font-bold tracking-tight">
            {activeTenant === "tecfag" ? "Tecfag Chat" : "Valem Chat"}
          </span>
        </div>

        {/* CITAÇÃO INFERIOR */}
        <div className="relative z-10 max-w-md mt-auto pt-16">
          <blockquote className="text-xl md:text-2xl font-medium leading-relaxed tracking-tight mb-6">
            “Simplesmente todas as ferramentas que minha equipe e eu precisamos.”
          </blockquote>
          <div>
            <cite className="not-italic block font-bold text-sm text-white">Karen Yue</cite>
            <span className="text-xs text-white/60">Diretora de Tecnologia de Marketing Digital</span>
          </div>
        </div>
      </div>

      {/* PAINEL DA DIREITA: Formulário de Login */}
      <div className="md:col-span-3 flex items-center justify-center p-6 sm:p-12 md:p-20 bg-white">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 220 }}
          className="w-full max-w-[420px] flex flex-col"
        >
          
          {/* Cabeçalho */}
          <div className="text-center md:text-left mb-8">
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
            <div className="relative border border-slate-200 rounded-xl px-4 py-2.5 bg-white transition-all duration-200 focus-within:border-[var(--primary)] focus-within:ring-2 focus-within:ring-[var(--primary)]/10">
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
                className="block w-full text-sm text-slate-900 bg-transparent border-0 p-0 focus:ring-0 focus:outline-none placeholder:text-slate-300"
              />
            </div>

            {/* Input Senha */}
            <div className="relative border border-slate-200 rounded-xl px-4 py-2.5 bg-white transition-all duration-200 focus-within:border-[var(--primary)] focus-within:ring-2 focus-within:ring-[var(--primary)]/10">
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
                  className="block w-full text-sm text-slate-900 bg-transparent border-0 p-0 focus:ring-0 focus:outline-none placeholder:text-slate-300"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-slate-400 hover:text-slate-600 focus:outline-none ml-2"
                >
                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </div>

            {/* Esqueceu a Senha */}
            <div className="text-left py-1">
              <a
                href="#forgot-password"
                className="text-xs font-bold text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors"
                onClick={(e) => {
                  e.preventDefault();
                  toast.info("A recuperação de senha deve ser solicitada ao administrador do sistema.");
                }}
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
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  rememberMe ? "bg-[var(--primary)]" : "bg-slate-200"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    rememberMe ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Botão Entrar */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-sm font-bold py-3.5 px-4 rounded-2xl shadow-sm transition duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:ring-offset-2 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-6"
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

          {/* Botão Google */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center gap-3 bg-slate-50 hover:bg-slate-100/80 text-slate-700 text-sm font-bold py-3.5 px-4 rounded-2xl border border-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-200 focus:ring-offset-1 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.81-2.6-2.43-4.53-4.53-4.53z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span>Continuar com o Google</span>
          </button>

          {/* Cadastro */}
          <div className="text-center mt-8">
            <p className="text-xs text-slate-500 font-medium">
              Não tem uma conta?{" "}
              <a
                href="#signup"
                className="font-bold text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors ml-1"
                onClick={(e) => {
                  e.preventDefault();
                  toast.info("O cadastro de novos operadores deve ser solicitado ao administrador.");
                }}
              >
                Cadastre-se
              </a>
            </p>
          </div>

        </motion.div>
      </div>
    </div>
  );
}
