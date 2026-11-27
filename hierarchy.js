export function neighborKind(order, kind, offset) {
  const index = order.indexOf(kind);
  return index < 0 ? null : order[index + offset] ?? null;
}
