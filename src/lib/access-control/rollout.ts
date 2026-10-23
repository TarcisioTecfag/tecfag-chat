/** Server-owned rollout gate. Enable a tenant only after its real memberships are mapped. */
export function strictAccessEnabled(tenantId: string, configured = process.env.ACCESS_CONTROL_STRICT_TENANTS ?? ""): boolean {
  return !!tenantId && configured.split(",").map((value) => value.trim()).filter(Boolean).includes(tenantId);
}
