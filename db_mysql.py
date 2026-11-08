import os
import re
from urllib.parse import urlparse, unquote

import pymysql

DATABASE_URL = os.environ.get('DATABASE_URL') or (
    'mysql+pymysql://testsystem:testsystempass@localhost:3306/testsystem?charset=utf8mb4'
)


def _connection_params(database=None):
    raw = DATABASE_URL
    parsed = urlparse(raw)
    params = dict(
        host=parsed.hostname or os.environ.get('DB_HOST', 'localhost'),
        port=parsed.port or int(os.environ.get('DB_PORT', '3306')),
        user=unquote(parsed.username or os.environ.get('DB_USER', 'testsystem')),
        password=unquote(parsed.password or os.environ.get('DB_PASSWORD', '')),
        charset='utf8mb4',
        autocommit=False,
        cursorclass=pymysql.cursors.Cursor,
    )
    if database:
        params['database'] = database
    return params


def _main_database():
    parsed = urlparse(DATABASE_URL)
    return (parsed.path or '/testsystem').lstrip('/') or 'testsystem'


class Cursor:
    def __init__(self, connection):
        self._connection = connection
        self._cursor = connection._conn.cursor()
        self._lastrowid = None

    def execute(self, sql, params=None):
        sql = re.sub(r'\?', '%s', sql)
        if params is None:
            self._cursor.execute(sql)
        else:
            self._cursor.execute(sql, params)
        self._lastrowid = self._cursor.lastrowid
        return self

    def executemany(self, sql, params):
        sql = re.sub(r'\?', '%s', sql)
        self._cursor.executemany(sql, params)
        return self

    def fetchone(self):
        row = self._cursor.fetchone()
        return tuple(row) if row is not None else None

    def fetchall(self):
        return [tuple(row) for row in self._cursor.fetchall()]

    @property
    def lastrowid(self):
        return self._lastrowid

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def close(self):
        self._cursor.close()


class MySQLConnection:
    def __init__(self, database):
        self._conn = pymysql.connect(**_connection_params(database))

    def cursor(self):
        return Cursor(self)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self._conn.rollback()
        else:
            self._conn.commit()
        self._conn.close()


def get_users_conn():
    return MySQLConnection(_main_database())


def lager_db_name(lager_id):
    safe = re.sub(r'[^A-Za-z0-9_]', '_', str(lager_id))
    return f'dms_lager_{safe}'


def _ensure_lager_database(lager_id):
    db_name = lager_db_name(lager_id)
    conn = pymysql.connect(**_connection_params(None))
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        conn.commit()
    finally:
        conn.close()
    return db_name


def get_lager_conn(lager_id):
    return MySQLConnection(_ensure_lager_database(lager_id))


def drop_lager_db(lager_id):
    db_name = lager_db_name(lager_id)
    conn = pymysql.connect(**_connection_params(None))
    try:
        with conn.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS `{db_name}`")
        conn.commit()
    finally:
        conn.close()


def lager_db_exists(lager_id):
    db_name = lager_db_name(lager_id)
    conn = pymysql.connect(**_connection_params(None))
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = %s",
                (db_name,),
            )
            return cur.fetchone() is not None
    finally:
        conn.close()
