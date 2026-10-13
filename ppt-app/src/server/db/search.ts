import { getPrisma } from './prisma';

// Keep binary identifiers and unique keys while preserving PostgreSQL's former
// case-insensitive contains filters. Query values are always bound parameters.
export async function projectSearchIds(userId: string, query: string) {
  const pattern = `%${query}%`;
  const rows = await getPrisma().$queryRaw<{ id: string }[]>`
    SELECT id FROM Project WHERE userId = ${userId}
    AND (LOWER(name) LIKE LOWER(${pattern}) OR LOWER(region) LIKE LOWER(${pattern}) OR LOWER(priceTier) LIKE LOWER(${pattern}))`;
  return rows.map(row => row.id);
}

export async function productSearchIds(ownerId: string, query: string) {
  const pattern = `%${query}%`;
  const rows = await getPrisma().$queryRaw<{ id: string }[]>`
    SELECT p.id FROM GlobalProduct p LEFT JOIN Brand b ON p.brandId = b.id
    WHERE p.ownerId = ${ownerId} AND (LOWER(p.sku) LIKE LOWER(${pattern}) OR LOWER(p.name) LIKE LOWER(${pattern})
    OR LOWER(p.searchText) LIKE LOWER(${pattern}) OR LOWER(b.name) LIKE LOWER(${pattern}))`;
  return rows.map(row => row.id);
}

export async function templateSearchIds(userId: string, query: string) {
  const pattern = `%${query}%`;
  const rows = await getPrisma().$queryRaw<{ id: string }[]>`
    SELECT id FROM TemplateDefinition WHERE (ownerId = ${userId} OR (isSystem = TRUE AND status = 'published'))
    AND LOWER(searchText) LIKE LOWER(${pattern})`;
  return rows.map(row => row.id);
}
