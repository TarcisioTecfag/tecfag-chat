/** Compartilha serviços entre chunks Nitro/SSR no mesmo processo Node. */
export function runtimeSingleton<T>(name: string, create: () => T): T {
  const key = Symbol.for("valem-chat.runtime-services");
  const runtime = globalThis as typeof globalThis & { [key: symbol]: Map<string, unknown> };
  const services = (runtime[key] ||= new Map<string, unknown>());
  if (!services.has(name)) services.set(name, create());
  return services.get(name) as T;
}
