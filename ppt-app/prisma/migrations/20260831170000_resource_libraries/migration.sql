-- CreateEnum
CREATE TYPE "GlobalProductStatus" AS ENUM ('active', 'inactive', 'archived');

-- Enable indexed partial-text lookup for Chinese names, SKUs, brands and item text.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "ProductAssetRole" AS ENUM ('primary', 'secondary', 'detail', 'package', 'manual');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ResourceScope" AS ENUM ('system', 'personal', 'organization');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "globalProductId" TEXT,
ADD COLUMN     "globalProductVersion" INTEGER,
ADD COLUMN     "snapshotTakenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "syncIgnoredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectDesign" ADD COLUMN     "templateDefinitionId" TEXT,
ADD COLUMN     "templateDefinitionVersion" INTEGER,
ADD COLUMN     "templateSnapshot" JSONB,
ADD COLUMN     "themeDefinitionId" TEXT,
ADD COLUMN     "themeDefinitionVersion" INTEGER,
ADD COLUMN     "themeSnapshot" JSONB;

-- Mark globally readable built-in template preview assets.
ALTER TABLE "Asset" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GlobalProduct" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "brandId" TEXT,
    "categoryId" TEXT,
    "description" TEXT,
    "items" JSONB NOT NULL,
    "marketPrice" DECIMAL(12,2),
    "defaultSalePrice" DECIMAL(12,2),
    "deliveryProfileId" TEXT,
    "deliveryOverrideText" TEXT,
    "status" "GlobalProductStatus" NOT NULL DEFAULT 'active',
    "primaryImageAssetId" TEXT,
    "searchText" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalProductVersion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeSummary" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalProductVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAsset" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "role" "ProductAssetRole" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoAssetId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryProfile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "includedRegions" JSONB NOT NULL,
    "excludedRegions" JSONB NOT NULL,
    "displayText" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeDefinition" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "rendererKey" TEXT NOT NULL,
    "tokens" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "scope" "ResourceScope" NOT NULL DEFAULT 'personal',
    "status" "TemplateStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThemeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateDefinition" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "thumbnailAssetId" TEXT,
    "themeDefinitionId" TEXT,
    "brandKitId" TEXT,
    "rendererKey" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "tags" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "scope" "ResourceScope" NOT NULL DEFAULT 'personal',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "previewDirty" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoAssetId" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "fontTitle" TEXT,
    "fontBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlobalProduct_ownerId_updatedAt_idx" ON "GlobalProduct"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "GlobalProduct_ownerId_status_updatedAt_idx" ON "GlobalProduct"("ownerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "GlobalProduct_ownerId_name_idx" ON "GlobalProduct"("ownerId", "name");

-- Search indexes used by the 5,000-product library list.
CREATE INDEX "GlobalProduct_name_trgm_idx" ON "GlobalProduct" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "GlobalProduct_sku_trgm_idx" ON "GlobalProduct" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX "GlobalProduct_searchText_trgm_idx" ON "GlobalProduct" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "GlobalProduct_ownerId_categoryId_idx" ON "GlobalProduct"("ownerId", "categoryId");

-- CreateIndex
CREATE INDEX "GlobalProduct_ownerId_brandId_idx" ON "GlobalProduct"("ownerId", "brandId");

-- CreateIndex
CREATE INDEX "GlobalProduct_ownerId_deliveryProfileId_idx" ON "GlobalProduct"("ownerId", "deliveryProfileId");

-- CreateIndex
CREATE INDEX "GlobalProduct_primaryImageAssetId_idx" ON "GlobalProduct"("primaryImageAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalProduct_ownerId_sku_key" ON "GlobalProduct"("ownerId", "sku");

-- CreateIndex
CREATE INDEX "GlobalProductVersion_productId_createdAt_idx" ON "GlobalProductVersion"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalProductVersion_productId_versionNumber_key" ON "GlobalProductVersion"("productId", "versionNumber");

-- CreateIndex
CREATE INDEX "ProductAsset_productId_role_sortOrder_idx" ON "ProductAsset"("productId", "role", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductAsset_assetId_idx" ON "ProductAsset"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAsset_productId_assetId_key" ON "ProductAsset"("productId", "assetId");

-- CreateIndex
CREATE INDEX "ProductCategory_ownerId_sortOrder_idx" ON "ProductCategory"("ownerId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductCategory_parentId_idx" ON "ProductCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_ownerId_parentId_name_key" ON "ProductCategory"("ownerId", "parentId", "name");

-- Stable code used to map existing catalog category identifiers.
CREATE UNIQUE INDEX "ProductCategory_ownerId_code_key" ON "ProductCategory"("ownerId", "code");

-- CreateIndex
CREATE INDEX "Brand_ownerId_updatedAt_idx" ON "Brand"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Brand_logoAssetId_idx" ON "Brand"("logoAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_ownerId_name_key" ON "Brand"("ownerId", "name");

-- CreateIndex
CREATE INDEX "DeliveryProfile_ownerId_updatedAt_idx" ON "DeliveryProfile"("ownerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryProfile_ownerId_name_key" ON "DeliveryProfile"("ownerId", "name");

-- CreateIndex
CREATE INDEX "ThemeDefinition_ownerId_status_updatedAt_idx" ON "ThemeDefinition"("ownerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ThemeDefinition_isSystem_status_idx" ON "ThemeDefinition"("isSystem", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ThemeDefinition_ownerId_name_key" ON "ThemeDefinition"("ownerId", "name");

-- CreateIndex
CREATE INDEX "TemplateDefinition_ownerId_category_status_updatedAt_idx" ON "TemplateDefinition"("ownerId", "category", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "TemplateDefinition_isSystem_status_updatedAt_idx" ON "TemplateDefinition"("isSystem", "status", "updatedAt");

CREATE INDEX "TemplateDefinition_ownerId_name_idx" ON "TemplateDefinition"("ownerId", "name");

CREATE INDEX "TemplateDefinition_searchText_trgm_idx" ON "TemplateDefinition" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "TemplateDefinition_themeDefinitionId_idx" ON "TemplateDefinition"("themeDefinitionId");

-- CreateIndex
CREATE INDEX "TemplateDefinition_thumbnailAssetId_idx" ON "TemplateDefinition"("thumbnailAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateDefinition_ownerId_name_key" ON "TemplateDefinition"("ownerId", "name");

-- CreateIndex
CREATE INDEX "TemplateFavorite_templateId_idx" ON "TemplateFavorite"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateFavorite_userId_templateId_key" ON "TemplateFavorite"("userId", "templateId");

-- CreateIndex
CREATE INDEX "BrandKit_logoAssetId_idx" ON "BrandKit"("logoAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandKit_ownerId_name_key" ON "BrandKit"("ownerId", "name");

-- CreateIndex
CREATE INDEX "Asset_userId_checksum_idx" ON "Asset"("userId", "checksum");

-- CreateIndex
CREATE INDEX "Product_globalProductId_globalProductVersion_idx" ON "Product"("globalProductId", "globalProductVersion");

-- CreateIndex
CREATE INDEX "ProjectDesign_templateDefinitionId_idx" ON "ProjectDesign"("templateDefinitionId");

-- CreateIndex
CREATE INDEX "ProjectDesign_themeDefinitionId_idx" ON "ProjectDesign"("themeDefinitionId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_globalProductId_fkey" FOREIGN KEY ("globalProductId") REFERENCES "GlobalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalProduct" ADD CONSTRAINT "GlobalProduct_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalProduct" ADD CONSTRAINT "GlobalProduct_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalProduct" ADD CONSTRAINT "GlobalProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalProduct" ADD CONSTRAINT "GlobalProduct_deliveryProfileId_fkey" FOREIGN KEY ("deliveryProfileId") REFERENCES "DeliveryProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalProduct" ADD CONSTRAINT "GlobalProduct_primaryImageAssetId_fkey" FOREIGN KEY ("primaryImageAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalProductVersion" ADD CONSTRAINT "GlobalProductVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "GlobalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalProductVersion" ADD CONSTRAINT "GlobalProductVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAsset" ADD CONSTRAINT "ProductAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "GlobalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAsset" ADD CONSTRAINT "ProductAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProfile" ADD CONSTRAINT "DeliveryProfile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDesign" ADD CONSTRAINT "ProjectDesign_templateDefinitionId_fkey" FOREIGN KEY ("templateDefinitionId") REFERENCES "TemplateDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDesign" ADD CONSTRAINT "ProjectDesign_themeDefinitionId_fkey" FOREIGN KEY ("themeDefinitionId") REFERENCES "ThemeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeDefinition" ADD CONSTRAINT "ThemeDefinition_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateDefinition" ADD CONSTRAINT "TemplateDefinition_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateDefinition" ADD CONSTRAINT "TemplateDefinition_thumbnailAssetId_fkey" FOREIGN KEY ("thumbnailAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateDefinition" ADD CONSTRAINT "TemplateDefinition_themeDefinitionId_fkey" FOREIGN KEY ("themeDefinitionId") REFERENCES "ThemeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateDefinition" ADD CONSTRAINT "TemplateDefinition_brandKitId_fkey" FOREIGN KEY ("brandKitId") REFERENCES "BrandKit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateFavorite" ADD CONSTRAINT "TemplateFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateFavorite" ADD CONSTRAINT "TemplateFavorite_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TemplateDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
