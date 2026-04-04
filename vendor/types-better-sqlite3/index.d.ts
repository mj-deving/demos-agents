declare namespace BetterSqlite3 {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    pluck(toggle?: boolean): this;
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  interface DatabaseOptions {
    allowExtension?: boolean;
  }

  interface Database {
    pragma(source: string, options?: { simple?: boolean }): unknown;
    exec(sql: string): this;
    prepare(sql: string): Statement;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    enableLoadExtension(enabled: boolean): this;
    loadExtension(path: string): this;
    close(): void;
  }
}

declare const BetterSqlite3: {
  new(filename: string, options?: BetterSqlite3.DatabaseOptions): BetterSqlite3.Database;
  prototype: BetterSqlite3.Database;
};

export = BetterSqlite3;
