export function parentKind(kind) {
  if (kind === "goal") return "idea";
  if (kind === "task") return "goal";
  return null;
}

export function childKind(kind) {
  if (kind === "idea") return "goal";
  if (kind === "goal") return "task";
  return null;
}
