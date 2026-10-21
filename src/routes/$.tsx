import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { isAppShellPath } from "@/lib/app-routes";

export const Route = createFileRoute("/$")({
  ssr: true,
  component: AppCatchAllRoute,
});

function AppCatchAllRoute() {
  const location = useLocation();

  if (isAppShellPath(location.pathname)) {
    // Renderizado de forma persistente (0ms remount) pelo PersistentAppShell em __root.tsx
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A rota acessada não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}
