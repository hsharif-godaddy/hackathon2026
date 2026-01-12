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

-- CreateTable
CREATE TABLE `social_posts` (
    `id` VARCHAR(191) NOT NULL,
    `site_id` VARCHAR(191) NOT NULL,
    `association_id` VARCHAR(191) NULL,
    `platform` VARCHAR(191) NOT NULL,
    `state` ENUM('SCHEDULED', 'PUBLISHED', 'FAILED') NOT NULL,
    `payload` JSON NOT NULL,
    `external_response` JSON NULL,
    `external_id` VARCHAR(191) NULL,
    `scheduled_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `campaign_id` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `social_posts_site_id_idx`(`site_id`),
    INDEX `social_posts_site_id_state_idx`(`site_id`, `state`),
    INDEX `social_posts_association_id_idx`(`association_id`),
    INDEX `social_posts_platform_idx`(`platform`),
    INDEX `social_posts_scheduled_at_idx`(`scheduled_at`),
    INDEX `social_posts_campaign_id_idx`(`campaign_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `social_associations` ADD CONSTRAINT `social_associations_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `social_posts` ADD CONSTRAINT `social_posts_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `social_posts` ADD CONSTRAINT `social_posts_association_id_fkey` FOREIGN KEY (`association_id`) REFERENCES `social_associations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
