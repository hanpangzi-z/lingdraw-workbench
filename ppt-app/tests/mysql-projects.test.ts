import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { getPrisma } from '@/src/server/db/prisma';
import { createProject, getProject, saveProject, listProjects, softDeleteProject, restoreProject } from '@/src/server/projects/service';

describe.skipIf(!process.env.PPT_DATABASE_URL?.startsWith('mysql:'))('MySQL project integration', () => {
  it('preserves project edits, scopes case-insensitive search, and rejects stale revisions', async () => {
    const prisma = getPrisma();
    const id = `mysql-test-${randomUUID()}`;
    await prisma.user.create({ data: { id, email: `${id}@example.invalid` } });
    try {
      const created = await createProject(id, { name: 'MySQL 中文 Case' });
      const loaded = await getProject(id, created.id);
      expect((await listProjects(id, { search: 'mysql 中文 case' })).items.map(item => item.id)).toContain(created.id);
      expect((await listProjects('unrelated-owner', { search: 'mysql' })).items).toHaveLength(0);
      await expect(getProject('unrelated-owner', created.id)).rejects.toThrow();
      const snapshot = structuredClone(loaded.snapshot);
      snapshot.project.subtitle = '中文内容 '.repeat(15000);
      await saveProject(id, created.id, loaded.revision, snapshot);
      await expect(saveProject(id, created.id, loaded.revision, snapshot)).rejects.toThrow();
      expect((await getProject(id, created.id)).snapshot.project.subtitle).toBe(snapshot.project.subtitle);
      await softDeleteProject(id, created.id);
      await expect(getProject(id, created.id)).rejects.toThrow();
      await restoreProject(id, created.id);
      expect((await getProject(id, created.id)).id).toBe(created.id);
    } finally {
      await prisma.user.delete({ where: { id } });
    }
  }, 30000);
});
