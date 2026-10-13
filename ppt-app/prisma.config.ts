import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations-mysql", seed: "tsx prisma/seed.ts" },
  datasource: {
    url: process.env.PPT_DATABASE_URL ?? process.env.DATABASE_URL,
  },
});
