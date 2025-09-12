-- Grant necessary privileges to airo user for Prisma migrations
-- This script runs during MySQL container initialization

-- Grant full privileges on the airo_app database to airo user
GRANT ALL PRIVILEGES ON airo_app.* TO 'airo'@'%';

-- Grant specific global privileges needed for Prisma migrations
GRANT CREATE, ALTER, DROP, INDEX, REFERENCES ON *.* TO 'airo'@'%';

-- Grant privileges needed for migration tables
GRANT CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, SELECT ON airo_app._prisma_migrations TO 'airo'@'%';

-- Ensure privileges are applied
FLUSH PRIVILEGES;

-- Log for debugging
SELECT 'Privileges granted to airo user for Prisma migrations' AS init_status;