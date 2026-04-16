// Generate a unique "<original> (cópia)" name, suffixing "(cópia 2)", "(cópia 3)", …
// if the base candidate is already taken in the provided list of existing names.
//
// Usage:
//   const existing = await prisma.technicalSheet.findMany({ where: { companyId }, select: { name: true } });
//   const newName = makeCopyName(source.name, existing.map(r => r.name));
export function makeCopyName(original, existingNames) {
  const existing = new Set((existingNames || []).map(n => String(n || '').trim()));
  const candidate = `${original} (cópia)`;
  if (!existing.has(candidate)) return candidate;
  let n = 2;
  while (existing.has(`${original} (cópia ${n})`)) n++;
  return `${original} (cópia ${n})`;
}
