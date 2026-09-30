// 初始化数据库：创建库并执行 db/schema.sql
import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
};
const dbName = process.env.DB_NAME || 'uniform';

async function waitDb(conn) {
  for (let i = 0; i < 30; i++) {
    try { await conn.query('SELECT 1'); return; } catch { await new Promise(r => setTimeout(r, 1000)); }
  }
}

const conn = await mysql.createConnection(cfg);
await waitDb(conn);
await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
await conn.query(`USE \`${dbName}\``);
const sql = await readFile(path.join(root, 'db', 'schema.sql'), 'utf8');
await conn.query(sql);

// 旧库升级：为已存在的表补列（幂等；information_schema 判断，兼容 MySQL 8 与 MariaDB）
async function columnExists(table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`,
    [table, column]);
  return rows.length > 0;
}
async function addColumn(table, column, ddl) {
  if (!(await columnExists(table, column))) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
    console.log(`[init-db] migrated: ${table}.${column} added`);
  }
}
await addColumn('plans', 'production_deadline',
  'production_deadline DATETIME NULL COMMENT "班级生产锁定截止日" AFTER order_deadline');
await addColumn('fitting_sessions', 'kind',
  "kind ENUM('regular','makeup') NOT NULL DEFAULT 'regular' AFTER class_id");
await addColumn('fitting_sessions', 'makeup_session_id',
  'makeup_session_id INT NULL COMMENT "补测安排" AFTER kind');
await addColumn('orders', 'size_lock',
  "size_lock ENUM('none','risk_placeholder','review','prelocked','locked') NOT NULL DEFAULT 'none' AFTER hold_reason");
await addColumn('orders', 'risk_placeholder',
  'risk_placeholder TINYINT(1) NOT NULL DEFAULT 0 AFTER size_lock');

console.log('[init-db] schema applied to database "' + dbName + '"');
await conn.end();
