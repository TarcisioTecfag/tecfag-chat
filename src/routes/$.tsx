import { createFileRoute, Link, useLocation, useRouterState } from "@tanstack/react-router";
import { isAppShellPath, isKnownStandalonePath } from "@/lib/app-routes";

export const Route = createFileRoute("/$")({
  ssr: true,
  component: AppCatchAllRoute,
});

function AppCatchAllRoute() {
  const location = useLocation();
  const { resolvedPathname, isTransitioning } = useRouterState({
    select: (state) => ({
      resolvedPathname: state.resolvedLocation?.pathname,
      isTransitioning: state.isTransitioning || state.status === "pending",
    }),
  });

  if (
    isAppShellPath(location.pathname) ||
    isKnownStandalonePath(location.pathname) ||
    (resolvedPathname &&
      (isAppShellPath(resolvedPathname) || isKnownStandalonePath(resolvedPathname))) ||
    isTransitioning
  ) {
    // Renderizado de forma persistente (0ms remount) pelo PersistentAppShell em __root.tsx
    // ou em transição ativa para rota dedicada (ex: /crm/deals/$dealId)
    return null;
  }

  return (
    <div className="fixed inset-0 flex h-full w-full items-center justify-center bg-background px-4">
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
