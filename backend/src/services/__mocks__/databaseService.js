import DatabaseServiceReal from '../databaseService.js';

class DatabaseServiceStub {
  constructor() {}
  async connect() {}
  async close() {}
  async run() {
    return {};
  }
  async get() {
    return null;
  }
  async all() {
    return [];
  }
  async transaction(fn) {
    return fn(this);
  }
}

export default class DatabaseService {
  constructor(dbPath = null) {
    const isReal = process.env.USE_REAL_DB === 'true';
    this.impl = isReal
      ? new DatabaseServiceReal(dbPath)
      : new DatabaseServiceStub(dbPath);
  }

  async connect() {
    return this.impl.connect();
  }

  async close() {
    return this.impl.close();
  }

  async run(sql, params) {
    return this.impl.run(sql, params);
  }

  async get(sql, params) {
    return this.impl.get(sql, params);
  }

  async all(sql, params) {
    return this.impl.all(sql, params);
  }

  async transaction(fn) {
    if (this.impl instanceof DatabaseServiceReal) {
      return this.impl.transaction(fn);
    }
    return fn(this);
  }

  // Add dynamic delegation for query method if it exists on real DatabaseService
  async query(sql, params) {
    if (typeof this.impl.query === 'function') {
      return this.impl.query(sql, params);
    }
    return [];
  }
}

export const databaseService = new DatabaseService();
