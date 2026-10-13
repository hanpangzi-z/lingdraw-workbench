import type { CandidateField, ProductCandidate, ProductDataConflict } from "../types";

const fields: Array<Exclude<CandidateField, "image">> = ["name", "items", "marketPrice", "salePrice", "delivery", "category"];
const normalized = (value: unknown) => Array.isArray(value) ? value.map(String).join("|").trim().toLowerCase() : String(value ?? "").replace(/\s+/g, "").toLowerCase();

export function mergeProductCandidates(candidates: ProductCandidate[]) {
  const groups = new Map<string, ProductCandidate[]>();
  candidates.forEach((candidate, index) => {
    const key = candidate.sku?.trim().toLowerCase() || `candidate:${index}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  });
  const conflicts: ProductDataConflict[] = [];
  const mergedCandidates = [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const primary = group[0];
    const merged: ProductCandidate = {
      ...primary,
      sources: group.flatMap((candidate) => candidate.sources),
      images: [...new Set(group.flatMap((candidate) => candidate.images ?? []))],
      fieldConfidence: { ...primary.fieldConfidence },
      confidence: Math.max(...group.map((candidate) => candidate.confidence)),
    };
    fields.forEach((field) => {
      const alternatives = group.flatMap((candidate) => {
        const value = candidate[field];
        return normalized(value) ? [{ candidateId: candidate.id, source: candidate.source, value }] : [];
      });
      const unique = [...new Map(alternatives.map((alternative) => [normalized(alternative.value), alternative])).values()];
      if (unique.length > 1) {
        conflicts.push({ id: `conflict-${primary.sku}-${field}`, sku: primary.sku ?? "", field, alternatives, resolved: false });
      }
      if (!normalized(merged[field]) && unique[0]) Object.assign(merged, { [field]: unique[0].value });
      merged.fieldConfidence[field] = Math.max(...group.map((candidate) => candidate.fieldConfidence[field] ?? 0));
    });
    return merged;
  });
  return { mergedCandidates, conflicts };
}
