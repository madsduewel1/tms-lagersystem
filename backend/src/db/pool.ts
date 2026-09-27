import mysql, { type RowDataPacket } from 'mysql2/promise';
import { config } from '../config/env.js';

export type SqlRow<T> = T & RowDataPacket;

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  decimalNumbers: true,
  dateStrings: false,
  charset: 'utf8mb4_unicode_ci',
});

export async function pingDatabase(): Promise<void> {
  await pool.query('SELECT 1');
}