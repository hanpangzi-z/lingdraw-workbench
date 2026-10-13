import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/src/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { folioPrisma?: PrismaClient };

export function getPrisma() {
  if (globalForPrisma.folioPrisma) return globalForPrisma.folioPrisma;
  const connectionString = process.env.PPT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("PPT_DATABASE_URL 未配置");
  const url = new URL(connectionString);
  if (url.protocol !== "mysql:" || !url.pathname.slice(1)) throw new Error("PPT_DATABASE_URL 必须配置 MySQL 数据库");
  const client = new PrismaClient({ adapter: new PrismaMariaDb({
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)), connectionLimit: 10,
    charset: "utf8mb4", timezone: "Z",
    connectTimeout: 5000, acquireTimeout: 5000, socketTimeout: 30000,
    allowPublicKeyRetrieval: process.env.PPT_MYSQL_ALLOW_PUBLIC_KEY_RETRIEVAL === 'true',
    ...(process.env.PPT_MYSQL_RSA_PUBLIC_KEY ? { cachingRsaPublicKey: process.env.PPT_MYSQL_RSA_PUBLIC_KEY } : {}),
  }) });
  // This is a long-lived standalone service, not a request-scoped serverless
  // function. Reusing one client prevents every RSC/API request from creating a
  // new database pool and exhausting the Node process under normal page concurrency.
  globalForPrisma.folioPrisma = client;
  return client;
}
