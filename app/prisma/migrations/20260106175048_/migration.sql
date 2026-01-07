-- CreateTable
CREATE TABLE `social_associations` (
    `id` VARCHAR(191) NOT NULL,
    `site_id` VARCHAR(191) NOT NULL,
    `social_id` VARCHAR(191) NOT NULL,
    `platform` ENUM('FACEBOOK', 'INSTAGRAM', 'GOOGLE_BUSINESS_PROFILE', 'TIKTOK', 'YELP', 'WHATSAPP') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `social_associations_site_id_platform_idx`(`site_id`, `platform`),
    UNIQUE INDEX `social_associations_site_id_social_id_key`(`site_id`, `social_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `social_associations` ADD CONSTRAINT `social_associations_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
