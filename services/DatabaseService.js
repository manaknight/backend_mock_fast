// src/services/DatabaseService.js
const pool = require("../core/Db.js");

/**
 * Comprehensive Database Service with ORM-like functionality and security measures
 * Abstracts MySQL-specific details and provides common database operations
 */
const DatabaseService = {
  _namespace: null, // Private property to store the namespace

  /**
   * Set the database namespace. All table operations will be prefixed with this.
   * @param {string} namespace - The namespace to set.
   */
  setNamespace: (namespace) => {
    if (
      !namespace ||
      typeof namespace !== "string" ||
      !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(namespace)
    ) {
      throw new Error(
        "Invalid namespace format. Must be a non-empty string with valid characters."
      );
    }
    DatabaseService._namespace = namespace;
  },

  /**
   * Get the current database namespace.
   * @returns {string|null} - The current namespace.
   */
  getNamespace: () => {
    return DatabaseService._namespace;
  },

  // =============================================================================
  // CORE QUERY METHODS
  // =============================================================================

  /**
   * Convert string decimal values to proper decimal numbers while preserving precision
   * @private
   * @param {*} value - The value to convert
   * @param {boolean} isDecimal - Whether this field is known to be decimal
   * @returns {number|string|null} - Converted value
   */
  _convertDecimalValue: (value, isDecimal = false) => {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return null;
    }

    // If we know it's a decimal or it looks like one
    if (
      isDecimal ||
      (typeof value === "string" && /^-?\d*\.?\d+$/.test(value))
    ) {
      // Convert to number while preserving precision
      const num = parseFloat(value);
      // Check if conversion was successful and value is finite
      if (!isNaN(num) && isFinite(num)) {
        return num;
      }
    }

    return value;
  },

  /**
   * Process row data to convert decimal strings to numbers
   * @private
   * @param {Object} row - Database row
   * @param {Object} fields - Field definitions from MySQL
   * @returns {Object} - Processed row
   */
  _processRowData: (row, fields) => {
    if (!row || typeof row !== "object") {
      return row;
    }

    const processed = { ...row };

    // If we have field definitions, use them to identify decimal fields
    if (fields) {
      Object.keys(processed).forEach((key) => {
        const field = fields.find((f) => f.name === key);
        if (field && field.type === "DECIMAL") {
          processed[key] = DatabaseService._convertDecimalValue(
            processed[key],
            true
          );
        }
      });
    } else {
      // If no field definitions, try to detect decimal values
      Object.keys(processed).forEach((key) => {
        processed[key] = DatabaseService._convertDecimalValue(processed[key]);
      });
    }

    return processed;
  },

  /**
   * Execute raw SQL query with security measures
   * @param {string} sql - SQL query
   * @param {Array<any>} params - Optional parameters for prepared statements
   * @param {Object} options - Query options
   * @returns {Promise<any>} - Query result
   */
  query: async (sql, params = [], options = {}) => {
    const startTime = Date.now();
    let connection = null;

    try {
      // Validate input
      if (!sql || typeof sql !== "string") {
        throw new Error("SQL query must be a non-empty string");
      }

      // Get connection from pool
      connection = options.connection || pool;
      // console.log(sql);
      // Execute with timeout protection and request field definitions
      const [rows, fields] = await Promise.race([
        connection.execute(sql, params, {
          dateStrings: true,
          decimalNumbers: true, // Request decimal numbers from MySQL
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Query timeout")),
            options.timeout || 30000
          )
        ),
      ]);

      // Log performance metrics (only in development)
      if (process.env.NODE_ENV === "development") {
        const duration = Date.now() - startTime;
        // console.log(
        //   `Query executed in ${duration}ms: ${sql.substring(0, 50)}...`
        // );
      }

      return rows;
    } catch (error) {
      // Log error securely (don't expose sensitive data)
      console.error("Database query error:", {
        message: error.message,
        code: error.code,
        sqlState: error.sqlState,
        timestamp: new Date().toISOString(),
      });

      // Throw sanitized error
      throw new Error(
        `Database operation failed: ${error.code || "UNKNOWN_ERROR"}`
      );
    }
  },

  /**
   * Execute query within a transaction
   * @param {Function} callback - Function that receives connection and executes queries
   * @returns {Promise<any>} - Transaction result
   */
  transaction: async (callback) => {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  // =============================================================================
  // GENERIC ORM METHODS
  // =============================================================================

  /**
   * Generic find method with filtering, sorting, and pagination
   * @param {string} tableName - Table name
   * @param {Object} options - Query options
   * @returns {Promise<Array>} - Found records
   */
  find: async (tableName, options = {}) => {
    const {
      where = {},
      select = "*",
      orderBy = {},
      limit = null,
      offset = 0,
      connection = null,
    } = options;

    // Validate table name
    DatabaseService._validateTableName(tableName);

    // Build SELECT clause
    const selectClause = Array.isArray(select)
      ? select
          .map((field) => DatabaseService._sanitizeColumnName(field))
          .join(", ")
      : select === "*"
      ? "*"
      : DatabaseService._sanitizeColumnName(select);

    // Build WHERE clause
    const { whereClause, whereParams } =
      DatabaseService._buildWhereClause(where);

    // Build ORDER BY clause
    const orderByClause = DatabaseService._buildOrderByClause(orderBy);

    // Build LIMIT clause
    const limitClause = limit
      ? `LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`
      : "";

    // First, get the table structure to identify decimal columns and their precision
    const describeQuery = `DESCRIBE ${DatabaseService._sanitizeTableName(
      tableName
    )}`;
    const tableStructure = await DatabaseService.query(describeQuery, [], {
      connection,
    });

    // Identify decimal columns and their precision
    const decimalColumns = tableStructure
      .filter((col) => col.Type.toLowerCase().includes("decimal"))
      .map((col) => {
        // Extract precision from Type field (e.g., "decimal(10,4)" -> [10,4])
        const match = col.Type.match(/decimal\((\d+),(\d+)\)/i);
        return {
          field: col.Field,
          precision: match ? parseInt(match[2]) : 4, // Default to 4 if not specified
        };
      });

    // Construct final query with CAST for decimal columns
    let selectFields;
    if (select === "*") {
      selectFields = tableStructure
        .map((col) => {
          const decimalCol = decimalColumns.find((d) => d.field === col.Field);
          if (decimalCol) {
            // Format number with exact precision using MySQL's FORMAT function
            return `FORMAT(${DatabaseService._sanitizeColumnName(col.Field)}, ${
              decimalCol.precision
            }) AS ${DatabaseService._sanitizeColumnName(col.Field)}`;
          }
          return DatabaseService._sanitizeColumnName(col.Field);
        })
        .join(", ");
    } else {
      const selectedFields = Array.isArray(select) ? select : [select];
      selectFields = selectedFields
        .map((field) => {
          const decimalCol = decimalColumns.find((d) => d.field === field);
          if (decimalCol) {
            // Format number with exact precision using MySQL's FORMAT function
            return `FORMAT(${DatabaseService._sanitizeColumnName(field)}, ${
              decimalCol.precision
            }) AS ${DatabaseService._sanitizeColumnName(field)}`;
          }
          return DatabaseService._sanitizeColumnName(field);
        })
        .join(", ");
    }

    // Construct final query
    const sql = `
      SELECT ${selectFields}
      FROM ${DatabaseService._sanitizeTableName(tableName)}
      ${whereClause}
      ${orderByClause}
      ${limitClause}
    `.trim();

    const results = await DatabaseService.query(sql, whereParams, {
      connection,
      decimalNumbers: true, // Ensure decimal handling is enabled
    });

    // Convert formatted strings back to numbers while preserving precision
    return results.map((row) => {
      const processed = { ...row };
      decimalColumns.forEach(({ field, precision }) => {
        if (processed[field] !== null && processed[field] !== undefined) {
          // Parse the formatted string back to a number with exact precision
          const num = Number(processed[field].replace(/,/g, ""));
          // Convert back to string with exact precision
          processed[field] = num.toFixed(precision);
        }
      });
      return processed;
    });
  },

  /**
   * Generic find one method
   * @param {string} tableName - Table name
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} - Found record or null
   */
  findOne: async (tableName, options = {}) => {
    const results = await DatabaseService.find(tableName, {
      ...options,
      limit: 1,
    });
    return results[0] || null;
  },

  /**
   * Generic count method
   * @param {string} tableName - Table name
   * @param {Object} where - Where conditions
   * @returns {Promise<number>} - Count of records
   */
  count: async (tableName, where = {}) => {
    DatabaseService._validateTableName(tableName);

    const { whereClause, whereParams } =
      DatabaseService._buildWhereClause(where);
    const sql = `SELECT COUNT(*) as count FROM ${DatabaseService._sanitizeTableName(
      tableName
    )} ${whereClause}`;

    const result = await DatabaseService.query(sql, whereParams);
    return result[0].count;
  },

  /**
   * Generic insert method
   * @param {string} tableName - Table name
   * @param {Object|Array} data - Data to insert
   * @param {Object} options - Insert options
   * @returns {Promise<Object>} - Insert result
   */
  insert: async (tableName, data, options = {}) => {
    DatabaseService._validateTableName(tableName);

    if (Array.isArray(data)) {
      return await DatabaseService.insertMany(tableName, data, options);
    }

    // Validate and sanitize data
    const sanitizedData = DatabaseService._sanitizeData(data);
    const columns = Object.keys(sanitizedData);
    const values = Object.values(sanitizedData);

    if (columns.length === 0) {
      throw new Error("Insert data cannot be empty");
    }

    const placeholders = columns.map(() => "?").join(", ");
    const columnNames = columns
      .map((col) => DatabaseService._sanitizeColumnName(col))
      .join(", ");

    const sql = `INSERT INTO ${DatabaseService._sanitizeTableName(
      tableName
    )} (${columnNames}) VALUES (${placeholders})`;

    const result = await DatabaseService.query(sql, values, options);
    return {
      id: result.insertId,
      affectedRows: result.affectedRows,
      ...sanitizedData,
    };
  },

  /**
   * Generic bulk insert method
   * @param {string} tableName - Table name
   * @param {Array} dataArray - Array of data objects to insert
   * @param {Object} options - Insert options
   * @returns {Promise<Object>} - Insert result
   */
  insertMany: async (tableName, dataArray, options = {}) => {
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      throw new Error("Insert data must be a non-empty array");
    }

    DatabaseService._validateTableName(tableName);

    // Use first object to determine columns
    const firstItem = DatabaseService._sanitizeData(dataArray[0]);
    const columns = Object.keys(firstItem);

    // Validate all items have same structure
    const sanitizedData = dataArray.map((item) => {
      const sanitized = DatabaseService._sanitizeData(item);
      const itemColumns = Object.keys(sanitized);

      if (
        JSON.stringify(itemColumns.sort()) !== JSON.stringify(columns.sort())
      ) {
        throw new Error(
          "All items in bulk insert must have the same structure"
        );
      }

      return columns.map((col) => sanitized[col]);
    });

    const columnNames = columns
      .map((col) => DatabaseService._sanitizeColumnName(col))
      .join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const valuesClause = sanitizedData
      .map(() => `(${placeholders})`)
      .join(", ");

    const sql = `INSERT INTO ${DatabaseService._sanitizeTableName(
      tableName
    )} (${columnNames}) VALUES ${valuesClause}`;
    const flatValues = sanitizedData.flat();

    const result = await DatabaseService.query(sql, flatValues, options);
    return {
      insertId: result.insertId,
      affectedRows: result.affectedRows,
    };
  },

  /**
   * Generic update method
   * @param {string} tableName - Table name
   * @param {Object} data - Data to update
   * @param {Object} where - Where conditions
   * @param {Object} options - Update options
   * @returns {Promise<Object>} - Update result
   */
  update: async (tableName, data, where = {}, options = {}) => {
    DatabaseService._validateTableName(tableName);

    if (Object.keys(where).length === 0) {
      throw new Error("Update operation requires WHERE conditions for safety");
    }

    const sanitizedData = DatabaseService._sanitizeData(data);
    const updateColumns = Object.keys(sanitizedData);

    if (updateColumns.length === 0) {
      throw new Error("Update data cannot be empty");
    }

    const setClause = updateColumns
      .map((col) => `${DatabaseService._sanitizeColumnName(col)} = ?`)
      .join(", ");

    const { whereClause, whereParams } =
      DatabaseService._buildWhereClause(where);
    const updateValues = Object.values(sanitizedData);

    const sql = `UPDATE ${DatabaseService._sanitizeTableName(
      tableName
    )} SET ${setClause} ${whereClause}`;

    const result = await DatabaseService.query(
      sql,
      [...updateValues, ...whereParams],
      options
    );
    return {
      affectedRows: result.affectedRows,
      changedRows: result.changedRows,
    };
  },

  /**
   * Generic delete method
   * @param {string} tableName - Table name
   * @param {Object} where - Where conditions
   * @param {Object} options - Delete options
   * @returns {Promise<Object>} - Delete result
   */
  delete: async (tableName, where = {}, options = {}) => {
    DatabaseService._validateTableName(tableName);

    if (Object.keys(where).length === 0 && !options.allowDeleteAll) {
      throw new Error(
        "Delete operation requires WHERE conditions for safety. Use allowDeleteAll: true to override."
      );
    }

    const { whereClause, whereParams } =
      DatabaseService._buildWhereClause(where);
    const sql = `DELETE FROM ${DatabaseService._sanitizeTableName(
      tableName
    )} ${whereClause}`;

    const result = await DatabaseService.query(sql, whereParams, options);
    return {
      affectedRows: result.affectedRows,
    };
  },

  // =============================================================================
  // PAGINATION HELPERS
  // =============================================================================

  /**
   * Get paginated results with metadata
   * @param {string} tableName - Table name
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} - Paginated results with metadata
   */
  paginate: async (tableName, options = {}) => {
    const {
      page = 1,
      pageSize = 20,
      where = {},
      orderBy = {},
      select = "*",
    } = options;

    const offset = (page - 1) * pageSize;
    const limit = pageSize;

    // Get total count
    const totalCount = await DatabaseService.count(tableName, where);

    // Get paginated data
    const data = await DatabaseService.find(tableName, {
      where,
      select,
      orderBy,
      limit,
      offset,
    });

    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      data,
      pagination: {
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  },

  // =============================================================================
  // HEALTH CHECK AND UTILITIES
  // =============================================================================

  /**
   * Check database connection health
   * @returns {Promise<Object>} - Health status
   */
  healthCheck: async () => {
    try {
      const startTime = Date.now();
      await DatabaseService.query("SELECT 1");
      const responseTime = Date.now() - startTime;

      return {
        status: "healthy",
        responseTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  },

  // =============================================================================
  // PRIVATE UTILITY METHODS
  // =============================================================================

  /**
   * Sanitize table name to prevent SQL injection
   * @private
   */
  _sanitizeTableName: (tableName) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error("Invalid table name");
    }
    const finalTableName = DatabaseService._namespace
      ? `${DatabaseService._namespace}_${tableName}`
      : tableName;
    return `\`${finalTableName}\``;
  },

  /**
   * Sanitize column name to prevent SQL injection
   * @private
   */
  _sanitizeColumnName: (columnName) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(columnName)) {
      throw new Error("Invalid column name");
    }
    return `\`${columnName}\``;
  },

  /**
   * Validate table name format
   * @private
   */
  _validateTableName: (tableName) => {
    if (!tableName || typeof tableName !== "string") {
      throw new Error("Table name must be a non-empty string");
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error("Invalid table name format");
    }
  },

  /**
   * Sanitize data object to prevent malicious input
   * @private
   */
  _sanitizeData: (data) => {
    if (!data || typeof data !== "object") {
      throw new Error("Data must be an object");
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      // Validate column names
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        throw new Error(`Invalid column name: ${key}`);
      }

      // Basic value sanitization
      if (value === undefined) {
        continue; // Skip undefined values
      }

      sanitized[key] = value;
    }

    return sanitized;
  },

  /**
   * Build WHERE clause from conditions object
   * @private
   */
  _buildWhereClause: (where) => {
    const conditions = [];
    const params = [];

    for (const [key, value] of Object.entries(where)) {
      const columnName = DatabaseService._sanitizeColumnName(key);

      if (value === null) {
        conditions.push(`${columnName} IS NULL`);
      } else if (Array.isArray(value)) {
        const placeholders = value.map(() => "?").join(", ");
        conditions.push(`${columnName} IN (${placeholders})`);
        params.push(...value);
      } else if (typeof value === "object" && value.operator) {
        // Support for complex operators like { operator: '>', value: 10 }
        const { operator, value: opValue } = value;
        const allowedOperators = [
          "=",
          "!=",
          "<>",
          ">",
          "<",
          ">=",
          "<=",
          "LIKE",
          "NOT LIKE",
        ];

        if (!allowedOperators.includes(operator.toUpperCase())) {
          throw new Error(`Invalid operator: ${operator}`);
        }

        conditions.push(`${columnName} ${operator} ?`);
        params.push(opValue);
      } else {
        conditions.push(`${columnName} = ?`);
        params.push(value);
      }
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return { whereClause, whereParams: params };
  },

  /**
   * Build ORDER BY clause from orderBy object
   * @private
   */
  _buildOrderByClause: (orderBy) => {
    if (!orderBy || Object.keys(orderBy).length === 0) {
      return "";
    }

    const orderClauses = [];
    for (const [column, direction] of Object.entries(orderBy)) {
      const columnName = DatabaseService._sanitizeColumnName(column);
      const dir = direction.toString().toUpperCase();

      if (!["ASC", "DESC"].includes(dir)) {
        throw new Error(`Invalid sort direction: ${direction}`);
      }

      orderClauses.push(`${columnName} ${dir}`);
    }

    return `ORDER BY ${orderClauses.join(", ")}`;
  },
};

module.exports = DatabaseService;
