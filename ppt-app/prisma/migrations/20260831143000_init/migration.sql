-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'ready', 'exported', 'archived');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('source_file', 'product_image', 'logo', 'generated_ppt', 'thumbnail');

-- CreateEnum
CREATE TYPE "ProjectAssetRole" AS ENUM ('source', 'product_image', 'logo', 'export', 'thumbnail');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "title" TEXT,
    "subtitle" TEXT,
    "tierName" TEXT,
    "edition" TEXT,
    "serviceLine" TEXT,
    "version" TEXT,
    "logoUrl" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'draft',
    "year" INTEGER,
    "region" TEXT,
    "priceTier" TEXT,
    "projectType" TEXT DEFAULT 'product-catalog',
    "templateId" TEXT NOT NULL DEFAULT 'business-red',
    "themeId" TEXT NOT NULL DEFAULT 'business-red',
    "thumbnailUrl" TEXT,
    "thumbnailAssetId" TEXT,
    "thumbnailDirty" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "slideCount" INTEGER NOT NULL DEFAULT 0,
    "categoryCount" INTEGER NOT NULL DEFAULT 0,
    "cachedSlidePlan" JSONB,
    "dataHash" TEXT,
    "batchConfig" JSONB,
    "lastOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "productNumber" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "packageCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "marketPrice" DECIMAL(12,2),
    "salePrice" DECIMAL(12,2),
    "delivery" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "region" TEXT,
    "priceTier" TEXT,
    "packageType" TEXT,
    "customerGroup" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,
    "primaryImageAssetId" TEXT,
    "imageAssetIds" JSONB,
    "imageUrls" JSONB,
    "imageMetadata" JSONB,
    "rawData" JSONB,
    "deliveryRaw" TEXT,
    "deliveryNormalized" TEXT,
    "aiMetadata" JSONB,
    "sources" JSONB,
    "importMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDesign" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "themeOverrides" JSONB NOT NULL,
    "logoAssetId" TEXT,
    "logoUrl" TEXT,
    "brandName" TEXT,
    "brandColor" TEXT,
    "pageRatio" TEXT NOT NULL DEFAULT '16:9',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDesign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEditorState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "slideOverrides" JSONB NOT NULL,
    "manualSlides" JSONB NOT NULL,
    "hiddenSlideIds" JSONB NOT NULL,
    "lockedSlideIds" JSONB NOT NULL,
    "pageOrder" JSONB NOT NULL,
    "selectedLayoutMode" TEXT NOT NULL DEFAULT 'smart',
    "layoutOverrides" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEditorState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAsset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "role" "ProjectAssetRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "label" TEXT,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "versionId" TEXT,
    "format" TEXT NOT NULL DEFAULT 'pptx',
    "pageCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectActivity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Project_userId_updatedAt_idx" ON "Project"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Project_userId_deletedAt_updatedAt_idx" ON "Project"("userId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Project_userId_name_idx" ON "Project"("userId", "name");

-- CreateIndex
CREATE INDEX "Product_projectId_sortOrder_idx" ON "Product"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "Product_projectId_sku_idx" ON "Product"("projectId", "sku");

-- CreateIndex
CREATE INDEX "Product_primaryImageAssetId_idx" ON "Product"("primaryImageAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_projectId_clientId_key" ON "Product"("projectId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDesign_projectId_key" ON "ProjectDesign"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEditorState_projectId_key" ON "ProjectEditorState"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_storageKey_key" ON "Asset"("storageKey");

-- CreateIndex
CREATE INDEX "Asset_userId_createdAt_idx" ON "Asset"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_type_idx" ON "Asset"("type");

-- CreateIndex
CREATE INDEX "ProjectAsset_projectId_role_idx" ON "ProjectAsset"("projectId", "role");

-- CreateIndex
CREATE INDEX "ProjectAsset_assetId_idx" ON "ProjectAsset"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAsset_projectId_assetId_role_key" ON "ProjectAsset"("projectId", "assetId", "role");

-- CreateIndex
CREATE INDEX "SourceFile_projectId_createdAt_idx" ON "SourceFile"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "SourceFile_assetId_idx" ON "SourceFile"("assetId");

-- CreateIndex
CREATE INDEX "ProjectVersion_projectId_createdAt_idx" ON "ProjectVersion"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectVersion_projectId_versionNumber_key" ON "ProjectVersion"("projectId", "versionNumber");

-- CreateIndex
CREATE INDEX "ExportRecord_projectId_createdAt_idx" ON "ExportRecord"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ExportRecord_assetId_idx" ON "ExportRecord"("assetId");

-- CreateIndex
CREATE INDEX "ProjectActivity_projectId_createdAt_idx" ON "ProjectActivity"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectActivity_userId_createdAt_idx" ON "ProjectActivity"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_primaryImageAssetId_fkey" FOREIGN KEY ("primaryImageAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDesign" ADD CONSTRAINT "ProjectDesign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDesign" ADD CONSTRAINT "ProjectDesign_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEditorState" ADD CONSTRAINT "ProjectEditorState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAsset" ADD CONSTRAINT "ProjectAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAsset" ADD CONSTRAINT "ProjectAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVersion" ADD CONSTRAINT "ProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVersion" ADD CONSTRAINT "ProjectVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportRecord" ADD CONSTRAINT "ExportRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportRecord" ADD CONSTRAINT "ExportRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
