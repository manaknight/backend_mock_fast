/**
 * QueryDSL - Domain Specific Language for automatic query parsing and execution
 *
 * Converts query strings like: status=paid&total>100&sort=-createdAt&limit=20&page=1
 * Into structured database queries with automatic validation and optimization
 */
class QueryDSL {
  constructor() {
    this.operators = {
      '=': '=',
      '!=': '!=',
      '>': '>',
      '<': '<',
      '>=': '>=',
      '<=': '<=',
      'like': 'LIKE',
      'ilike': 'ILIKE',
      'in': 'IN',
      'nin': 'NOT IN',
      'null': 'IS NULL',
      'nnull': 'IS NOT NULL'
    };

    this.sortDirections = {
      'asc': 'ASC',
      'desc': 'DESC',
      '1': 'ASC',
      '-1': 'DESC'
    };
  }

  /**
   * Parse query string into structured query object
   * @param {Object} queryParams - Express req.query object
   * @returns {Object} - Structured query for DatabaseService
   */
  parse(queryParams) {
    const query = {
      where: {},
      select: '*',
      orderBy: {},
      limit: null,
      offset: 0
    };

    // Parse each query parameter
    Object.entries(queryParams).forEach(([key, value]) => {
      if (this.isSpecialParam(key)) {
        this.parseSpecialParam(key, value, query);
      } else {
        this.parseFilterParam(key, value, query);
      }
    });

    // Apply defaults and validation
    this.applyDefaults(query);

    return query;
  }

  /**
   * Check if parameter is a special query parameter (not a filter)
   */
  isSpecialParam(key) {
    const specialParams = [
      'select', 'fields', // Field selection
      'sort', 'order', 'orderby', // Sorting
      'limit', 'page', 'offset', // Pagination
      'include', 'with', // Relations
      'search', 'q' // Full-text search
    ];

    return specialParams.includes(key.toLowerCase());
  }

  /**
   * Parse special query parameters
   */
  parseSpecialParam(key, value, query) {
    const keyLower = key.toLowerCase();

    switch (keyLower) {
      case 'select':
      case 'fields':
        query.select = this.parseSelectFields(value);
        break;

      case 'sort':
      case 'order':
      case 'orderby':
        query.orderBy = this.parseSortFields(value);
        break;

      case 'limit':
        query.limit = this.parseLimit(value);
        break;

      case 'page':
        query.page = parseInt(value);
        break;

      case 'offset':
        query.offset = parseInt(value);
        break;

      case 'include':
      case 'with':
        query.include = this.parseIncludes(value);
        break;

      case 'search':
      case 'q':
        query.search = this.parseSearchQuery(value);
        break;
    }
  }

  /**
   * Parse filter parameters
   */
  parseFilterParam(key, value, query) {
    // Handle complex operators in key (e.g., field__gt, field__like)
    const [fieldName, operator] = this.parseFieldOperator(key);

    // Parse the value based on operator
    const parsedValue = this.parseFilterValue(value, operator);

    // Add to where clause
    if (operator === 'in' || operator === 'nin') {
      query.where[fieldName] = parsedValue;
    } else if (operator === 'null' || operator === 'nnull') {
      query.where[fieldName] = null;
    } else {
      query.where[fieldName] = parsedValue;
    }
  }

  /**
   * Parse field name and operator from parameter key
   * Supports formats: field, field__op, field[op]
   */
  parseFieldOperator(key) {
    // Handle field__operator format (Django-style)
    if (key.includes('__')) {
      const parts = key.split('__');
      const operator = parts.pop();
      const field = parts.join('__');

      return [field, this.mapOperator(operator)];
    }

    // Handle field[operator] format
    const bracketMatch = key.match(/^(.+)\[(.+)\]$/);
    if (bracketMatch) {
      return [bracketMatch[1], this.mapOperator(bracketMatch[2])];
    }

    // Handle operator in value (field>value, field<value, etc.)
    const valueOperatorMatch = key.match(/^(.+)([=<>!]+)(.+)$/);
    if (valueOperatorMatch) {
      const [, field, op, val] = valueOperatorMatch;
      return [field, this.mapOperator(op)];
    }

    // Default to equals
    return [key, '='];
  }

  /**
   * Map string operators to standard operators
   */
  mapOperator(op) {
    const operatorMap = {
      'eq': '=',
      'ne': '!=',
      'gt': '>',
      'gte': '>=',
      'lt': '<',
      'lte': '<=',
      'like': 'like',
      'ilike': 'ilike',
      'in': 'in',
      'nin': 'nin',
      'null': 'null',
      'nnull': 'nnull',
      'is': 'null', // 'is null'
      'not': 'nnull' // 'is not null'
    };

    return operatorMap[op.toLowerCase()] || op;
  }

  /**
   * Parse filter value based on operator
   */
  parseFilterValue(value, operator) {
    if (operator === 'in' || operator === 'nin') {
      // Handle comma-separated values or array notation
      if (Array.isArray(value)) {
        return value.map(v => this.parseScalarValue(v));
      }
      return value.split(',').map(v => v.trim()).map(v => this.parseScalarValue(v));
    }

    if (operator === 'like' || operator === 'ilike') {
      // Add wildcards if not present
      if (!value.includes('%')) {
        return `%${value}%`;
      }
      return value;
    }

    return this.parseScalarValue(value);
  }

  /**
   * Parse scalar values (numbers, booleans, dates)
   */
  parseScalarValue(value) {
    // Handle boolean strings
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Handle null
    if (value === 'null') return null;

    // Handle numbers
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return parseFloat(value);
    }

    // Handle dates
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return new Date(value);
    }

    // Return as string
    return value;
  }

  /**
   * Parse SELECT fields
   */
  parseSelectFields(value) {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === 'string') {
      return value.split(',').map(field => field.trim());
    }

    return '*';
  }

  /**
   * Parse sort fields
   */
  parseSortFields(value) {
    const orderBy = {};

    if (Array.isArray(value)) {
      value.forEach(sortSpec => {
        Object.assign(orderBy, this.parseSortSpec(sortSpec));
      });
    } else if (typeof value === 'string') {
      // Handle comma-separated sort specs
      value.split(',').forEach(sortSpec => {
        Object.assign(orderBy, this.parseSortSpec(sortSpec.trim()));
      });
    } else if (typeof value === 'object') {
      // Already an object
      Object.assign(orderBy, value);
    }

    return orderBy;
  }

  /**
   * Parse individual sort specification
   */
  parseSortSpec(sortSpec) {
    const orderBy = {};

    if (typeof sortSpec === 'string') {
      // Handle field:direction format
      if (sortSpec.includes(':')) {
        const [field, direction] = sortSpec.split(':');
        orderBy[field] = this.sortDirections[direction] || direction.toUpperCase();
      } else if (sortSpec.startsWith('-')) {
        // Handle -field format (descending)
        orderBy[sortSpec.slice(1)] = 'DESC';
      } else {
        // Default ascending
        orderBy[sortSpec] = 'ASC';
      }
    }

    return orderBy;
  }

  /**
   * Parse limit parameter
   */
  parseLimit(value) {
    const limit = parseInt(value);
    return Math.min(Math.max(limit, 1), 1000); // Between 1 and 1000
  }

  /**
   * Parse includes/with for relations
   */
  parseIncludes(value) {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === 'string') {
      return value.split(',').map(rel => rel.trim());
    }

    return [];
  }

  /**
   * Parse search query
   */
  parseSearchQuery(value) {
    return {
      query: value,
      fields: ['name', 'title', 'description', 'content'] // Default searchable fields
    };
  }

  /**
   * Apply defaults and calculate pagination
   */
  applyDefaults(query) {
    // Default limit
    if (!query.limit && query.page) {
      query.limit = 20;
    }

    // Calculate offset from page
    if (query.page && query.limit) {
      query.offset = (query.page - 1) * query.limit;
    }

    // Ensure limit is reasonable
    if (query.limit && query.limit > 1000) {
      query.limit = 1000;
    }

    // Ensure offset is valid
    if (query.offset < 0) {
      query.offset = 0;
    }
  }

  /**
   * Validate query structure
   */
  validate(query) {
    const errors = [];

    // Validate field names (basic SQL injection prevention)
    Object.keys(query.where || {}).forEach(field => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
        errors.push(`Invalid field name: ${field}`);
      }
    });

    if (query.select !== '*' && Array.isArray(query.select)) {
      query.select.forEach(field => {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
          errors.push(`Invalid select field: ${field}`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Optimize query for performance
   */
  optimize(query, schemaInfo = {}) {
    // Add automatic indexes for frequently filtered fields
    const suggestedIndexes = [];

    // Analyze WHERE clauses for index suggestions
    Object.keys(query.where || {}).forEach(field => {
      if (!schemaInfo.indexes || !schemaInfo.indexes.some(idx => idx.columns.includes(field))) {
        suggestedIndexes.push({
          table: schemaInfo.table,
          columns: [field],
          reason: 'Frequently filtered field'
        });
      }
    });

    // Analyze ORDER BY for index suggestions
    Object.keys(query.orderBy || {}).forEach(field => {
      if (!schemaInfo.indexes || !schemaInfo.indexes.some(idx => idx.columns.includes(field))) {
        suggestedIndexes.push({
          table: schemaInfo.table,
          columns: [field],
          reason: 'Frequently sorted field'
        });
      }
    });

    return {
      query,
      suggestions: {
        indexes: suggestedIndexes
      }
    };
  }

  /**
   * Build SQL query string from parsed query (for debugging)
   */
  buildSQL(tableName, query) {
    let sql = 'SELECT ';

    // SELECT
    if (query.select === '*') {
      sql += '*';
    } else if (Array.isArray(query.select)) {
      sql += query.select.join(', ');
    } else {
      sql += query.select;
    }

    sql += ` FROM \`${tableName}\``;

    // WHERE
    if (query.where && Object.keys(query.where).length > 0) {
      const whereConditions = [];
      Object.entries(query.where).forEach(([field, value]) => {
        if (value === null) {
          whereConditions.push(`\`${field}\` IS NULL`);
        } else if (Array.isArray(value)) {
          whereConditions.push(`\`${field}\` IN (${value.map(() => '?').join(', ')})`);
        } else {
          whereConditions.push(`\`${field}\` = ?`);
        }
      });
      sql += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    // ORDER BY
    if (query.orderBy && Object.keys(query.orderBy).length > 0) {
      const orderClauses = Object.entries(query.orderBy).map(([field, dir]) => `\`${field}\` ${dir}`);
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }

    // LIMIT/OFFSET
    if (query.limit) {
      sql += ` LIMIT ${query.limit}`;
      if (query.offset) {
        sql += ` OFFSET ${query.offset}`;
      }
    }

    return sql;
  }

  /**
   * Extract parameters for prepared statements
   */
  extractParams(query) {
    const params = [];

    if (query.where) {
      Object.values(query.where).forEach(value => {
        if (Array.isArray(value)) {
          params.push(...value);
        } else if (value !== null) {
          params.push(value);
        }
      });
    }

    return params;
  }
}

module.exports = new QueryDSL();
