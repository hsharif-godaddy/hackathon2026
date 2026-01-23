/*
  Warnings:

  - You are about to drop the `social_associations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `social_posts` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `social_associations` DROP FOREIGN KEY `social_associations_site_id_fkey`;

-- DropForeignKey
ALTER TABLE `social_posts` DROP FOREIGN KEY `social_posts_association_id_fkey`;

-- DropForeignKey
ALTER TABLE `social_posts` DROP FOREIGN KEY `social_posts_site_id_fkey`;

-- DropTable
DROP TABLE `social_associations`;

-- DropTable
DROP TABLE `social_posts`;
