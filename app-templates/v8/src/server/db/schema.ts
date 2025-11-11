import { mysqlSchema } from "drizzle-orm/mysql-core";

export const appSchema = mysqlSchema(process.env.MYSQL_DATABASE || 'appdb')
