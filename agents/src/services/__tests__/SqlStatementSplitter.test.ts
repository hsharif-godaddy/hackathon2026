/**
 * SqlStatementSplitter Test Suite
 *
 * Tests for the SQL statement splitter covering:
 * - Basic semicolon splitting
 * - String literals with semicolons
 * - DELIMITER commands
 * - Block and line comments
 * - BOM stripping
 * - SQL sanitization rules
 * - Chunk boundary handling
 */

import { describe, it, expect } from 'vitest';
import { SqlStatementSplitter } from '../SqlStatementSplitter.js';

describe('SqlStatementSplitter', () => {
  describe('basic splitting', () => {
    it('should split simple statements on semicolons', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements(
        'CREATE TABLE foo (id INT); INSERT INTO foo VALUES (1); SELECT * FROM foo;',
      );
      expect(stmts).toEqual([
        'CREATE TABLE foo (id INT)',
        'INSERT INTO foo VALUES (1)',
        'SELECT * FROM foo',
      ]);
    });

    it('should handle multi-line statements', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements(
        'CREATE TABLE foo (\n  id INT,\n  name VARCHAR(100)\n);\nSELECT 1;',
      );
      expect(stmts).toHaveLength(2);
      expect(stmts[0]).toContain('CREATE TABLE foo');
    });

    it('should skip empty statements', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements('SELECT 1;; ;SELECT 2;');
      expect(stmts).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('should flush remaining buffer', () => {
      const splitter = new SqlStatementSplitter();
      const stmts1 = splitter.splitStatements('SELECT 1; SELECT 2');
      expect(stmts1).toEqual(['SELECT 1']);

      const stmts2 = splitter.flush();
      expect(stmts2).toEqual(['SELECT 2']);
    });

    it('should return empty array from flush when buffer is empty', () => {
      const splitter = new SqlStatementSplitter();
      splitter.splitStatements('SELECT 1;');
      expect(splitter.flush()).toEqual([]);
    });
  });

  describe('string literals', () => {
    it('should not split on semicolons inside single quotes', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements(
        "INSERT INTO t VALUES ('foo;bar'); SELECT 1;",
      );
      expect(stmts).toEqual([
        "INSERT INTO t VALUES ('foo;bar')",
        'SELECT 1',
      ]);
    });

    it('should not split on semicolons inside double quotes', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements(
        'INSERT INTO t VALUES ("foo;bar"); SELECT 1;',
      );
      expect(stmts).toEqual([
        'INSERT INTO t VALUES ("foo;bar")',
        'SELECT 1',
      ]);
    });

    it('should handle escaped single quotes', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements(
        "INSERT INTO t VALUES ('it\\'s;ok'); SELECT 1;",
      );
      expect(stmts).toEqual([
        "INSERT INTO t VALUES ('it\\'s;ok')",
        'SELECT 1',
      ]);
    });

    it('should handle doubled single quotes', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements(
        "INSERT INTO t VALUES ('it''s;ok'); SELECT 1;",
      );
      expect(stmts).toEqual([
        "INSERT INTO t VALUES ('it''s;ok')",
        'SELECT 1',
      ]);
    });

    it('should handle backtick-quoted identifiers', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements(
        'SELECT `col;name` FROM t; SELECT 1;',
      );
      expect(stmts).toEqual([
        'SELECT `col;name` FROM t',
        'SELECT 1',
      ]);
    });
  });

  describe('comments', () => {
    it('should handle single-line comments (--)', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements(
        '-- This is a comment\nSELECT 1; -- inline\nSELECT 2;',
      );
      expect(stmts).toHaveLength(2);
      expect(stmts[0]).toContain('SELECT 1');
      expect(stmts[1]).toContain('SELECT 2');
    });

    it('should handle single-line comments (#)', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements(
        '# MySQL comment\nSELECT 1;',
      );
      expect(stmts).toHaveLength(1);
    });

    it('should handle block comments', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements(
        '/* block; comment */\nSELECT 1; /* inline; comment */ SELECT 2;',
      );
      expect(stmts).toHaveLength(2);
    });

    it('should not split on semicolons inside block comments', () => {
      const splitter = new SqlStatementSplitter();
      const stmts = splitter.splitStatements(
        'SELECT /* ; */ 1;',
      );
      expect(stmts).toEqual(['SELECT /* ; */ 1']);
    });
  });

  describe('DELIMITER command', () => {
    it('should handle custom delimiter for stored procedures', () => {
      const splitter = new SqlStatementSplitter();
      const sql = [
        'DELIMITER $$',
        'CREATE PROCEDURE test()',
        'BEGIN',
        '  SELECT 1;',
        '  SELECT 2;',
        'END$$',
        'DELIMITER ;',
        'SELECT 3;',
      ].join('\n');

      const stmts = splitter.splitStatements(sql);
      // The procedure body should be one statement (split on $$)
      // Then SELECT 3 split on ;
      expect(stmts.some(s => s.includes('CREATE PROCEDURE'))).toBe(true);
      expect(stmts.some(s => s.trim() === 'SELECT 3')).toBe(true);
    });

    it('should handle DELIMITER with // separator', () => {
      const splitter = new SqlStatementSplitter();
      const sql = [
        'DELIMITER //',
        'CREATE TRIGGER test BEFORE INSERT ON t FOR EACH ROW',
        'BEGIN',
        '  SET NEW.x = 1;',
        'END//',
        'DELIMITER ;',
        'SELECT 1;',
      ].join('\n');

      const stmts = splitter.splitStatements(sql);
      expect(stmts.some(s => s.includes('CREATE TRIGGER'))).toBe(true);
      expect(stmts.some(s => s.trim() === 'SELECT 1')).toBe(true);
    });
  });

  describe('BOM stripping', () => {
    it('should strip UTF-8 BOM from first chunk', () => {
      const splitter = new SqlStatementSplitter();
      const bom = '\uFEFF';
      const stmts = splitter.splitStatements(bom + 'SELECT 1;');
      expect(stmts).toEqual(['SELECT 1']);
    });

    it('should not strip BOM from subsequent chunks', () => {
      const splitter = new SqlStatementSplitter();
      splitter.splitStatements('SELECT 1;');

      // BOM in subsequent chunks is kept in the buffer (part of statement text)
      // but may be trimmed by sanitization — verify the statement is still parsed
      const stmts = splitter.splitStatements('\uFEFFSELECT 2;');
      expect(stmts).toHaveLength(1);
      expect(stmts[0]).toContain('SELECT 2');
    });
  });

  describe('chunk boundaries', () => {
    it('should handle statement split across chunks', () => {
      const splitter = new SqlStatementSplitter();
      const stmts1 = splitter.splitStatements('INSERT INTO t VAL');
      expect(stmts1).toEqual([]);

      const stmts2 = splitter.splitStatements('UES (1);');
      expect(stmts2).toEqual(['INSERT INTO t VALUES (1)']);
    });

    it('should handle string literal split across chunks', () => {
      const splitter = new SqlStatementSplitter();
      const stmts1 = splitter.splitStatements("INSERT INTO t VALUES ('foo");
      expect(stmts1).toEqual([]);

      const stmts2 = splitter.splitStatements(";bar');");
      expect(stmts2).toEqual(["INSERT INTO t VALUES ('foo;bar')"]);
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      const splitter = new SqlStatementSplitter();
      splitter.splitStatements("INSERT INTO t VALUES ('partial");
      splitter.reset();

      const stmts = splitter.splitStatements('SELECT 1;');
      expect(stmts).toEqual(['SELECT 1']);
    });

    it('should re-enable BOM stripping after reset', () => {
      const splitter = new SqlStatementSplitter();
      splitter.splitStatements('SELECT 1;');
      splitter.reset();

      const stmts = splitter.splitStatements('\uFEFFSELECT 2;');
      expect(stmts).toEqual(['SELECT 2']);
    });
  });

  describe('sanitization', () => {
    it('should strip DEFINER clauses', () => {
      const result = SqlStatementSplitter.sanitizeStatement(
        "CREATE DEFINER=`admin`@`%` PROCEDURE test() BEGIN SELECT 1; END",
      );
      expect(result).not.toContain('DEFINER');
      expect(result).toContain('CREATE');
      expect(result).toContain('PROCEDURE test()');
    });

    it('should strip DEFINER with single quotes', () => {
      const result = SqlStatementSplitter.sanitizeStatement(
        "CREATE DEFINER='root'@'localhost' VIEW v AS SELECT 1",
      );
      expect(result).not.toContain('DEFINER');
      expect(result).toContain('VIEW v AS SELECT 1');
    });

    it('should skip CREATE DATABASE statements', () => {
      const result = SqlStatementSplitter.sanitizeStatement(
        'CREATE DATABASE IF NOT EXISTS mydb',
      );
      expect(result).toBeNull();
    });

    it('should skip DROP DATABASE statements', () => {
      const result = SqlStatementSplitter.sanitizeStatement('DROP DATABASE mydb');
      expect(result).toBeNull();
    });

    it('should skip USE statements', () => {
      const result = SqlStatementSplitter.sanitizeStatement('USE mydb');
      expect(result).toBeNull();
    });

    it('should skip LOCK TABLES statements', () => {
      const result = SqlStatementSplitter.sanitizeStatement('LOCK TABLES foo WRITE');
      expect(result).toBeNull();
    });

    it('should skip UNLOCK TABLES', () => {
      const result = SqlStatementSplitter.sanitizeStatement('UNLOCK TABLES');
      expect(result).toBeNull();
    });

    it('should skip SET @@GLOBAL.GTID_PURGED', () => {
      const result = SqlStatementSplitter.sanitizeStatement(
        "SET @@GLOBAL.GTID_PURGED='abc123'",
      );
      expect(result).toBeNull();
    });

    it('should strip NO_AUTO_CREATE_USER from sql_mode', () => {
      const result = SqlStatementSplitter.sanitizeStatement(
        "SET sql_mode='STRICT_TRANS_TABLES,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'",
      );
      expect(result).not.toBeNull();
      expect(result!).not.toContain('NO_AUTO_CREATE_USER');
      expect(result!).toContain('STRICT_TRANS_TABLES');
    });

    it('should keep valid statements unchanged', () => {
      const stmt = "INSERT INTO users (name) VALUES ('John')";
      const result = SqlStatementSplitter.sanitizeStatement(stmt);
      expect(result).toBe(stmt);
    });

    it('should return null for comment-only statements', () => {
      expect(SqlStatementSplitter.sanitizeStatement('-- just a comment')).toBeNull();
      expect(SqlStatementSplitter.sanitizeStatement('/* block comment */')).toBeNull();
    });

    it('should return null for empty statements', () => {
      expect(SqlStatementSplitter.sanitizeStatement('')).toBeNull();
      expect(SqlStatementSplitter.sanitizeStatement('   ')).toBeNull();
    });

    it('should skip GRANT statements', () => {
      expect(SqlStatementSplitter.sanitizeStatement("GRANT ALL PRIVILEGES ON *.* TO 'admin'@'%'")).toBeNull();
      expect(SqlStatementSplitter.sanitizeStatement("GRANT SELECT ON mydb.* TO 'reader'@'localhost'")).toBeNull();
    });

    it('should skip REVOKE statements', () => {
      expect(SqlStatementSplitter.sanitizeStatement("REVOKE ALL PRIVILEGES ON *.* FROM 'admin'@'%'")).toBeNull();
    });

    it('should skip CREATE USER statements', () => {
      expect(SqlStatementSplitter.sanitizeStatement("CREATE USER 'hacker'@'%' IDENTIFIED BY 'pass'")).toBeNull();
    });

    it('should skip DROP USER statements', () => {
      expect(SqlStatementSplitter.sanitizeStatement("DROP USER 'victim'@'%'")).toBeNull();
    });

    it('should skip ALTER USER statements', () => {
      expect(SqlStatementSplitter.sanitizeStatement("ALTER USER 'root'@'%' IDENTIFIED BY 'newpass'")).toBeNull();
    });

    it('should skip RENAME USER statements', () => {
      expect(SqlStatementSplitter.sanitizeStatement("RENAME USER 'old'@'%' TO 'new'@'%'")).toBeNull();
    });

    it('should skip SET PASSWORD statements', () => {
      expect(SqlStatementSplitter.sanitizeStatement("SET PASSWORD FOR 'root'@'%' = 'newpass'")).toBeNull();
    });
  });

  describe('mixed scenarios', () => {
    it('should handle a realistic mysqldump header', () => {
      const splitter = new SqlStatementSplitter();
      const dump = [
        '-- MySQL dump 10.13  Distrib 8.0.32',
        '--',
        '-- Host: localhost    Database: myapp',
        '-- ------------------------------------------------------',
        '',
        "/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;",
        "/*!40101 SET NAMES utf8mb4 */;",
        '',
        'DROP TABLE IF EXISTS `users`;',
        'CREATE TABLE `users` (',
        '  `id` int NOT NULL AUTO_INCREMENT,',
        "  `name` varchar(100) DEFAULT 'unnamed;user',",
        '  PRIMARY KEY (`id`)',
        ') ENGINE=InnoDB;',
        '',
        "INSERT INTO `users` VALUES (1,'John;Doe');",
      ].join('\n');

      const stmts = splitter.splitStatements(dump);
      const remaining = splitter.flush();
      const all = [...stmts, ...remaining];

      // Should have: 2 SET statements, DROP, CREATE, INSERT
      expect(all.length).toBeGreaterThanOrEqual(4);
      expect(all.some(s => s.includes('DROP TABLE'))).toBe(true);
      expect(all.some(s => s.includes('CREATE TABLE'))).toBe(true);
      expect(all.some(s => s.includes("'John;Doe'"))).toBe(true);
    });
  });
});
