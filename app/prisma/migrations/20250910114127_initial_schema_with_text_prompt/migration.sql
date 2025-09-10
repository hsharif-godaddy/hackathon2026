-- CreateTable
CREATE TABLE `accounts` (
    `id` VARCHAR(191) NOT NULL,
    `shopper_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `plan_id` VARCHAR(191) NULL,
    `status` ENUM('active', 'suspended', 'closed') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `accounts_shopper_id_key`(`shopper_id`),
    UNIQUE INDEX `accounts_customer_id_key`(`customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plans` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `site_limit` INTEGER NOT NULL DEFAULT 10,
    `price` DECIMAL(65, 30) NOT NULL DEFAULT 0.00,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `plans_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sites` (
    `id` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `initial_prompt` TEXT NULL,
    `domain` VARCHAR(191) NULL,
    `agent_url` VARCHAR(191) NULL,
    `backend_url` VARCHAR(191) NULL,
    `preview_url` VARCHAR(191) NULL,
    `ceph_mount_id` VARCHAR(191) NULL,
    `ceph_dir_number` VARCHAR(191) NULL,
    `status` ENUM('init', 'creating', 'created', 'running', 'stopped', 'error', 'failed') NOT NULL DEFAULT 'stopped',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sites_ceph_mount_id_ceph_dir_number_idx`(`ceph_mount_id`, `ceph_dir_number`),
    INDEX `sites_account_id_idx`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sites` ADD CONSTRAINT `sites_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
