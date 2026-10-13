ALTER TABLE "User" ADD COLUMN "externalUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE UNIQUE INDEX "User_externalUserId_key" ON "User"("externalUserId");
