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

// 幂等迁移：为已存在的旧库补列（新库由 schema.sql 直接建好，下列 ADD 会自动跳过）
async function columnExists(table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) n FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`, [table, column]);
  return Number(rows[0].n) > 0;
}
async function addColumn(table, column, ddl) {
  if (!(await columnExists(table, column))) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
    console.log(`[init-db] migrated: ${table}.${column}`);
  }
}
// orders：新增 review 状态与生产锁定列（通过扩大枚举/新增列兼容旧库）
if (!(await columnExists('orders', 'production_lock'))) {
  await conn.query(
    `ALTER TABLE orders
       MODIFY COLUMN status ENUM('draft','confirmed','paid','hold','cancelled','review') NOT NULL DEFAULT 'draft',
       ADD COLUMN production_lock ENUM('none','placeholder','locked','prelocked','deferred') NOT NULL DEFAULT 'none' AFTER status`);
  console.log('[init-db] migrated: orders.status enum + production_lock');
}
// fitting_sessions：补测场标记
await addColumn('fitting_sessions', 'kind',
  "kind ENUM('regular','makeup') NOT NULL DEFAULT 'regular' AFTER class_id");
await addColumn('fitting_sessions', 'makeup_session_id',
  'makeup_session_id INT NULL AFTER kind');
// plans：两次确认时限
await addColumn('plans', 'teacher_confirm_hours',
  'teacher_confirm_hours INT NOT NULL DEFAULT 24 AFTER fitting_date');
await addColumn('plans', 'parent_confirm_hours',
  'parent_confirm_hours INT NOT NULL DEFAULT 48 AFTER teacher_confirm_hours');

console.log(`[init-db] schema applied to database "${dbName}"`);
await conn.end();
