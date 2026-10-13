-- CreateTable
CREATE TABLE `ImageGenerationJob` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `started` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` BIGINT NOT NULL,

    INDEX `ImageGenerationJob_userId_updatedAt_idx`(`userId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `UploadSession` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `updatedAt` BIGINT NOT NULL,
    `completed` BOOLEAN NOT NULL DEFAULT false,

    INDEX `UploadSession_userId_completed_updatedAt_idx`(`userId`, `completed`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `externalUserId` VARCHAR(191) NULL,
    `username` LONGTEXT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` LONGTEXT NULL,
    `name` LONGTEXT NULL,
    `avatarUrl` LONGTEXT NULL,
    `role` LONGTEXT NOT NULL DEFAULT ('user'),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_externalUserId_key`(`externalUserId`),
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `Project` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` LONGTEXT NULL,
    `brand` LONGTEXT NULL,
    `title` LONGTEXT NULL,
    `subtitle` LONGTEXT NULL,
    `tierName` LONGTEXT NULL,
    `edition` LONGTEXT NULL,
    `serviceLine` LONGTEXT NULL,
    `version` LONGTEXT NULL,
    `logoUrl` LONGTEXT NULL,
    `status` ENUM('draft', 'ready', 'exported', 'archived') NOT NULL DEFAULT 'draft',
    `year` INTEGER NULL,
    `region` LONGTEXT NULL,
    `priceTier` LONGTEXT NULL,
    `projectType` LONGTEXT NULL DEFAULT ('product-catalog'),
    `templateId` LONGTEXT NOT NULL DEFAULT ('business-red'),
    `themeId` LONGTEXT NOT NULL DEFAULT ('business-red'),
    `thumbnailUrl` LONGTEXT NULL,
    `thumbnailAssetId` LONGTEXT NULL,
    `thumbnailDirty` BOOLEAN NOT NULL DEFAULT true,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `productCount` INTEGER NOT NULL DEFAULT 0,
    `slideCount` INTEGER NOT NULL DEFAULT 0,
    `categoryCount` INTEGER NOT NULL DEFAULT 0,
    `cachedSlidePlan` JSON NULL,
    `dataHash` LONGTEXT NULL,
    `batchConfig` JSON NULL,
    `lastOpenedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Project_userId_updatedAt_idx`(`userId`, `updatedAt`),
    INDEX `Project_userId_deletedAt_updatedAt_idx`(`userId`, `deletedAt`, `updatedAt`),
    INDEX `Project_userId_name_idx`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `globalProductId` VARCHAR(191) NULL,
    `globalProductVersion` INTEGER NULL,
    `productNumber` LONGTEXT NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `packageCode` LONGTEXT NOT NULL,
    `name` LONGTEXT NOT NULL,
    `items` JSON NOT NULL,
    `marketPrice` DECIMAL(12, 2) NULL,
    `salePrice` DECIMAL(12, 2) NULL,
    `delivery` JSON NOT NULL,
    `category` LONGTEXT NOT NULL,
    `region` LONGTEXT NULL,
    `priceTier` LONGTEXT NULL,
    `packageType` LONGTEXT NULL,
    `customerGroup` LONGTEXT NULL,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL,
    `primaryImageAssetId` VARCHAR(191) NULL,
    `imageAssetIds` JSON NULL,
    `imageUrls` JSON NULL,
    `imageMetadata` JSON NULL,
    `rawData` JSON NULL,
    `deliveryRaw` LONGTEXT NULL,
    `deliveryNormalized` LONGTEXT NULL,
    `aiMetadata` JSON NULL,
    `sources` JSON NULL,
    `importMetadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `snapshotTakenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `syncIgnoredAt` DATETIME(3) NULL,

    INDEX `Product_projectId_sortOrder_idx`(`projectId`, `sortOrder`),
    INDEX `Product_projectId_sku_idx`(`projectId`, `sku`),
    INDEX `Product_globalProductId_globalProductVersion_idx`(`globalProductId`, `globalProductVersion`),
    INDEX `Product_primaryImageAssetId_idx`(`primaryImageAssetId`),
    UNIQUE INDEX `Product_projectId_clientId_key`(`projectId`, `clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `GlobalProduct` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `shortName` LONGTEXT NULL,
    `brandId` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NULL,
    `description` LONGTEXT NULL,
    `items` JSON NOT NULL,
    `marketPrice` DECIMAL(12, 2) NULL,
    `defaultSalePrice` DECIMAL(12, 2) NULL,
    `deliveryProfileId` VARCHAR(191) NULL,
    `deliveryOverrideText` LONGTEXT NULL,
    `status` ENUM('active', 'inactive', 'archived') NOT NULL DEFAULT 'active',
    `primaryImageAssetId` VARCHAR(191) NULL,
    `searchText` TEXT NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GlobalProduct_ownerId_updatedAt_idx`(`ownerId`, `updatedAt`),
    INDEX `GlobalProduct_ownerId_status_updatedAt_idx`(`ownerId`, `status`, `updatedAt`),
    INDEX `GlobalProduct_ownerId_name_idx`(`ownerId`, `name`),
    INDEX `GlobalProduct_ownerId_categoryId_idx`(`ownerId`, `categoryId`),
    INDEX `GlobalProduct_ownerId_brandId_idx`(`ownerId`, `brandId`),
    INDEX `GlobalProduct_ownerId_deliveryProfileId_idx`(`ownerId`, `deliveryProfileId`),
    INDEX `GlobalProduct_primaryImageAssetId_idx`(`primaryImageAssetId`),
    UNIQUE INDEX `GlobalProduct_ownerId_sku_key`(`ownerId`, `sku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `GlobalProductVersion` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,
    `changeSummary` LONGTEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GlobalProductVersion_productId_createdAt_idx`(`productId`, `createdAt`),
    UNIQUE INDEX `GlobalProductVersion_productId_versionNumber_key`(`productId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `ProductAsset` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `role` ENUM('primary', 'secondary', 'detail', 'package', 'manual') NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductAsset_productId_role_sortOrder_idx`(`productId`, `role`, `sortOrder`),
    INDEX `ProductAsset_assetId_idx`(`assetId`),
    UNIQUE INDEX `ProductAsset_productId_assetId_key`(`productId`, `assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `ProductCategory` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProductCategory_ownerId_sortOrder_idx`(`ownerId`, `sortOrder`),
    INDEX `ProductCategory_parentId_idx`(`parentId`),
    UNIQUE INDEX `ProductCategory_ownerId_parentId_name_key`(`ownerId`, `parentId`, `name`),
    UNIQUE INDEX `ProductCategory_ownerId_code_key`(`ownerId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `Brand` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `logoAssetId` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Brand_ownerId_updatedAt_idx`(`ownerId`, `updatedAt`),
    INDEX `Brand_logoAssetId_idx`(`logoAssetId`),
    UNIQUE INDEX `Brand_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `DeliveryProfile` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` LONGTEXT NULL,
    `includedRegions` JSON NOT NULL,
    `excludedRegions` JSON NOT NULL,
    `displayText` LONGTEXT NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DeliveryProfile_ownerId_updatedAt_idx`(`ownerId`, `updatedAt`),
    UNIQUE INDEX `DeliveryProfile_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `ProjectDesign` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `templateId` LONGTEXT NOT NULL,
    `themeId` LONGTEXT NOT NULL,
    `themeOverrides` JSON NOT NULL,
    `logoAssetId` VARCHAR(191) NULL,
    `logoUrl` LONGTEXT NULL,
    `brandName` LONGTEXT NULL,
    `brandColor` LONGTEXT NULL,
    `pageRatio` LONGTEXT NOT NULL DEFAULT ('16:9'),
    `templateDefinitionId` VARCHAR(191) NULL,
    `templateDefinitionVersion` INTEGER NULL,
    `templateSnapshot` JSON NULL,
    `themeDefinitionId` VARCHAR(191) NULL,
    `themeDefinitionVersion` INTEGER NULL,
    `themeSnapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProjectDesign_projectId_key`(`projectId`),
    INDEX `ProjectDesign_templateDefinitionId_idx`(`templateDefinitionId`),
    INDEX `ProjectDesign_themeDefinitionId_idx`(`themeDefinitionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `ProjectEditorState` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `slideOverrides` JSON NOT NULL,
    `manualSlides` JSON NOT NULL,
    `hiddenSlideIds` JSON NOT NULL,
    `lockedSlideIds` JSON NOT NULL,
    `pageOrder` JSON NOT NULL,
    `selectedLayoutMode` LONGTEXT NOT NULL DEFAULT ('smart'),
    `layoutOverrides` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProjectEditorState_projectId_key`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `Asset` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('source_file', 'product_image', 'logo', 'generated_ppt', 'thumbnail') NOT NULL,
    `fileName` LONGTEXT NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `mimeType` LONGTEXT NOT NULL,
    `size` BIGINT NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `checksum` VARCHAR(191) NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `metadata` JSON NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Asset_storageKey_key`(`storageKey`),
    INDEX `Asset_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Asset_userId_checksum_idx`(`userId`, `checksum`),
    INDEX `Asset_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `ThemeDefinition` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `rendererKey` LONGTEXT NOT NULL,
    `tokens` JSON NOT NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `scope` ENUM('system', 'personal', 'organization') NOT NULL DEFAULT 'personal',
    `status` ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
    `version` INTEGER NOT NULL DEFAULT 1,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ThemeDefinition_ownerId_status_updatedAt_idx`(`ownerId`, `status`, `updatedAt`),
    INDEX `ThemeDefinition_isSystem_status_idx`(`isSystem`, `status`),
    UNIQUE INDEX `ThemeDefinition_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `TemplateDefinition` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` LONGTEXT NULL,
    `category` VARCHAR(191) NOT NULL,
    `status` ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
    `version` INTEGER NOT NULL DEFAULT 1,
    `thumbnailAssetId` VARCHAR(191) NULL,
    `themeDefinitionId` VARCHAR(191) NULL,
    `brandKitId` VARCHAR(191) NULL,
    `rendererKey` LONGTEXT NOT NULL,
    `config` JSON NOT NULL,
    `tags` JSON NOT NULL,
    `searchText` TEXT NOT NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `scope` ENUM('system', 'personal', 'organization') NOT NULL DEFAULT 'personal',
    `usageCount` INTEGER NOT NULL DEFAULT 0,
    `previewDirty` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TemplateDefinition_ownerId_category_status_updatedAt_idx`(`ownerId`, `category`, `status`, `updatedAt`),
    INDEX `TemplateDefinition_isSystem_status_updatedAt_idx`(`isSystem`, `status`, `updatedAt`),
    INDEX `TemplateDefinition_ownerId_name_idx`(`ownerId`, `name`),
    INDEX `TemplateDefinition_themeDefinitionId_idx`(`themeDefinitionId`),
    INDEX `TemplateDefinition_thumbnailAssetId_idx`(`thumbnailAssetId`),
    UNIQUE INDEX `TemplateDefinition_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `TemplateFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TemplateFavorite_templateId_idx`(`templateId`),
    UNIQUE INDEX `TemplateFavorite_userId_templateId_key`(`userId`, `templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `BrandKit` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `logoAssetId` VARCHAR(191) NULL,
    `primaryColor` LONGTEXT NULL,
    `secondaryColor` LONGTEXT NULL,
    `fontTitle` LONGTEXT NULL,
    `fontBody` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BrandKit_logoAssetId_idx`(`logoAssetId`),
    UNIQUE INDEX `BrandKit_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `ProjectAsset` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `role` ENUM('source', 'product_image', 'logo', 'export', 'thumbnail') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectAsset_projectId_role_idx`(`projectId`, `role`),
    INDEX `ProjectAsset_assetId_idx`(`assetId`),
    UNIQUE INDEX `ProjectAsset_projectId_assetId_role_key`(`projectId`, `assetId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `SourceFile` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `sourceType` LONGTEXT NOT NULL,
    `originalName` LONGTEXT NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SourceFile_projectId_createdAt_idx`(`projectId`, `createdAt`),
    INDEX `SourceFile_assetId_idx`(`assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `ProjectVersion` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,
    `label` LONGTEXT NULL,
    `reason` LONGTEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectVersion_projectId_createdAt_idx`(`projectId`, `createdAt`),
    UNIQUE INDEX `ProjectVersion_projectId_versionNumber_key`(`projectId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `ExportRecord` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `versionId` LONGTEXT NULL,
    `format` LONGTEXT NOT NULL DEFAULT ('pptx'),
    `pageCount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExportRecord_projectId_createdAt_idx`(`projectId`, `createdAt`),
    INDEX `ExportRecord_assetId_idx`(`assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `ProjectActivity` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` LONGTEXT NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectActivity_projectId_createdAt_idx`(`projectId`, `createdAt`),
    INDEX `ProjectActivity_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_primaryImageAssetId_fkey` FOREIGN KEY (`primaryImageAssetId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_globalProductId_fkey` FOREIGN KEY (`globalProductId`) REFERENCES `GlobalProduct`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GlobalProduct` ADD CONSTRAINT `GlobalProduct_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GlobalProduct` ADD CONSTRAINT `GlobalProduct_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `Brand`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GlobalProduct` ADD CONSTRAINT `GlobalProduct_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ProductCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GlobalProduct` ADD CONSTRAINT `GlobalProduct_deliveryProfileId_fkey` FOREIGN KEY (`deliveryProfileId`) REFERENCES `DeliveryProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GlobalProduct` ADD CONSTRAINT `GlobalProduct_primaryImageAssetId_fkey` FOREIGN KEY (`primaryImageAssetId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GlobalProductVersion` ADD CONSTRAINT `GlobalProductVersion_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `GlobalProduct`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GlobalProductVersion` ADD CONSTRAINT `GlobalProductVersion_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductAsset` ADD CONSTRAINT `ProductAsset_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `GlobalProduct`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductAsset` ADD CONSTRAINT `ProductAsset_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductCategory` ADD CONSTRAINT `ProductCategory_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductCategory` ADD CONSTRAINT `ProductCategory_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `ProductCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Brand` ADD CONSTRAINT `Brand_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Brand` ADD CONSTRAINT `Brand_logoAssetId_fkey` FOREIGN KEY (`logoAssetId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryProfile` ADD CONSTRAINT `DeliveryProfile_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectDesign` ADD CONSTRAINT `ProjectDesign_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectDesign` ADD CONSTRAINT `ProjectDesign_logoAssetId_fkey` FOREIGN KEY (`logoAssetId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectDesign` ADD CONSTRAINT `ProjectDesign_templateDefinitionId_fkey` FOREIGN KEY (`templateDefinitionId`) REFERENCES `TemplateDefinition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectDesign` ADD CONSTRAINT `ProjectDesign_themeDefinitionId_fkey` FOREIGN KEY (`themeDefinitionId`) REFERENCES `ThemeDefinition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectEditorState` ADD CONSTRAINT `ProjectEditorState_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ThemeDefinition` ADD CONSTRAINT `ThemeDefinition_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TemplateDefinition` ADD CONSTRAINT `TemplateDefinition_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TemplateDefinition` ADD CONSTRAINT `TemplateDefinition_thumbnailAssetId_fkey` FOREIGN KEY (`thumbnailAssetId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TemplateDefinition` ADD CONSTRAINT `TemplateDefinition_themeDefinitionId_fkey` FOREIGN KEY (`themeDefinitionId`) REFERENCES `ThemeDefinition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TemplateDefinition` ADD CONSTRAINT `TemplateDefinition_brandKitId_fkey` FOREIGN KEY (`brandKitId`) REFERENCES `BrandKit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TemplateFavorite` ADD CONSTRAINT `TemplateFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TemplateFavorite` ADD CONSTRAINT `TemplateFavorite_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `TemplateDefinition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BrandKit` ADD CONSTRAINT `BrandKit_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BrandKit` ADD CONSTRAINT `BrandKit_logoAssetId_fkey` FOREIGN KEY (`logoAssetId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectAsset` ADD CONSTRAINT `ProjectAsset_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectAsset` ADD CONSTRAINT `ProjectAsset_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SourceFile` ADD CONSTRAINT `SourceFile_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SourceFile` ADD CONSTRAINT `SourceFile_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectVersion` ADD CONSTRAINT `ProjectVersion_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectVersion` ADD CONSTRAINT `ProjectVersion_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExportRecord` ADD CONSTRAINT `ExportRecord_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExportRecord` ADD CONSTRAINT `ExportRecord_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectActivity` ADD CONSTRAINT `ProjectActivity_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectActivity` ADD CONSTRAINT `ProjectActivity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
