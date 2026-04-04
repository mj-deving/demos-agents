"use strict";

const { DatabaseSync } = require("node:sqlite");

function firstColumnValue(row) {
  if (row === undefined || row === null) {
    return row;
  }
  const values = Object.values(row);
  return values.length === 0 ? undefined : values[0];
}

class Statement {
  constructor(statement) {
    this.statement = statement;
    this.shouldPluck = false;
  }

  pluck(toggle = true) {
    this.shouldPluck = toggle;
    return this;
  }

  run(...params) {
    return this.statement.run(...params);
  }

  get(...params) {
    const row = this.statement.get(...params);
    return this.shouldPluck ? firstColumnValue(row) : row;
  }

  all(...params) {
    const rows = this.statement.all(...params);
    return this.shouldPluck ? rows.map((row) => firstColumnValue(row)) : rows;
  }
}

class Database {
  constructor(filename, options = {}) {
    const dbOpts = {};
    if (options.allowExtension) dbOpts.allowExtension = true;
    this.db = new DatabaseSync(filename, dbOpts);
  }

  enableLoadExtension(enabled) {
    this.db.enableLoadExtension(enabled);
    return this;
  }

  pragma(source, options = {}) {
    const sql = source.trim().toUpperCase().startsWith("PRAGMA ")
      ? source
      : `PRAGMA ${source}`;
    const rows = this.prepare(sql).all();
    if (options.simple) {
      return rows.length === 0 ? undefined : firstColumnValue(rows[0]);
    }
    return rows;
  }

  exec(sql) {
    this.db.exec(sql);
    return this;
  }

  prepare(sql) {
    return new Statement(this.db.prepare(sql));
  }

  transaction(fn) {
    return (...args) => {
      this.db.exec("BEGIN");
      try {
        const result = fn(...args);
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // Ignore rollback failures and preserve the original error.
        }
        throw error;
      }
    };
  }

  loadExtension(path) {
    this.db.loadExtension(path);
    return this;
  }

  close() {
    this.db.close();
  }
}

module.exports = Database;
