// `force` skips the "source text unchanged" check and so spends model calls; only a privileged caller (service-role
// key or signed-in admin) may use it. Anyone else gets it silently treated as false.
export function effectiveForce(requested: unknown, privileged: boolean): boolean {
  return requested === true && privileged === true;
}
