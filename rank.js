const digits = "0123456789abcdef";

export function isRank(value) {
  return typeof value === "string" && /^[0-9a-f]*[1-9a-f]$/.test(value);
}

export function rankOf(item) {
  const created = Number.isSafeInteger(item.created) ? item.created : 0;
  const legacyRank = (BigInt(Number.MAX_SAFE_INTEGER) - BigInt(created)).toString().padStart(17, "0");
  let id = "";
  for (let index = 0; index < item.id.length; index++) {
    id += item.id.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return (item.rank ?? legacyRank) + "0" + id + "1";
}

export function compareRank(a, b) {
  const left = rankOf(a);
  const right = rankOf(b);
  if (left !== right) return left < right ? -1 : 1;
  return a.id < b.id ? -1 : a.id === b.id ? 0 : 1;
}

// Leave space for later insertions and give simultaneous drops distinct ranks.
export function rankBetween(left, right) {
  let prefix = "";
  let bounded = right !== null && right !== left;
  for (let index = 0; ; index++) {
    const lower = digits.indexOf(left?.[index] ?? "0");
    const upper = bounded ? digits.indexOf(right[index]) : digits.length;
    if (upper - lower > 1) {
      return prefix + digits[Math.floor((lower + upper) / 2)] + crypto.randomUUID().replaceAll("-", "") + "1";
    }
    prefix += digits[lower];
    if (lower < upper) bounded = false;
  }
}
