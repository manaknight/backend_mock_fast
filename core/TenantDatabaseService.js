/**
 * TenantDatabaseService - A proxy for DatabaseService that automatically
 * namespaces table names based on the current tenant (project).
 */
class TenantDatabaseService {
  constructor(baseService, tenantId) {
    this.baseService = baseService;
    this.tenantId = tenantId;
  }

  // Helper to prefix table names
  _prefix(tableName) {
    return `${this.tenantId}_${tableName}`;
  }

  /**
   * Find records in a table, automatically namespacing the table name.
   */
  async find(tableName, options = {}) {
    return this.baseService.find(this._prefix(tableName), options);
  }

  /**
   * Find a single record in a table, automatically namespacing the table name.
   */
  async findOne(tableName, options = {}) {
    return this.baseService.findOne(this._prefix(tableName), options);
  }

  /**
   * Create a record in a table, automatically namespacing the table name.
   */
  async create(tableName, data) {
    return this.baseService.create(this._prefix(tableName), data);
  }

  /**
   * Update records in a table, automatically namespacing the table name.
   */
  async update(tableName, data, options = {}) {
    return this.baseService.update(this._prefix(tableName), data, options);
  }

  /**
   * Delete records from a table, automatically namespacing the table name.
   */
  async delete(tableName, options = {}) {
    return this.baseService.delete(this._prefix(tableName), options);
  }
}

module.exports = TenantDatabaseService;
