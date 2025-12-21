const DatabaseService = require("./DatabaseService.js");

/**
 * Production-ready SQL Query Builder Class
 * Handles complex query generation with comprehensive validation
 */
class SQLQueryBuilder {
  constructor(namespace, userId, config = {}) {
    if (!namespace || !userId) {
      throw new Error("Namespace and userId are required");
    }

    this.namespace = namespace;
    this.userId = userId;
    this.errors = [];
    this.warnings = [];
    this.complexity = 0;
    this.config = {
      userIdField: config.userIdField || "user_id", // Default to user_id
      userFilterTable: config.userFilterTable || null, // Optional specific table alias for user filter
    };
  }

  /**
   * Main method to build SQL from structured query object
   */
  async buildQuery(queryObj) {
    try {
      this.validateQueryStructure(queryObj);

      if (this.errors.length > 0) {
        throw new Error(`Query validation failed: ${this.errors.join(", ")}`);
      }

      const sql = await this.generateSQL(queryObj);
      const params = this.extractParameters(queryObj);

      return {
        sql,
        params,
        complexity: this.getComplexityLevel(),
        warnings: this.warnings,
      };
    } catch (error) {
      throw new Error(`SQL generation failed: ${error.message}`);
    }
  }

  /**
   * Comprehensive query structure validation
   */
  validateQueryStructure(query) {
    // Basic structure validation
    if (!query || typeof query !== "object") {
      this.errors.push("Query must be a valid object");
      return;
    }

    if (
      !query.select ||
      !Array.isArray(query.select) ||
      query.select.length === 0
    ) {
      this.errors.push("Query must have at least one SELECT expression");
    }

    if (!query.from || typeof query.from !== "object" || !query.from.table) {
      this.errors.push("Query must have a valid FROM clause");
    }

    // Validate SELECT expressions
    this.validateSelectExpressions(query.select);

    // Validate CTEs if present
    if (query.ctes) {
      this.validateCTEs(query.ctes);
    }

    // Validate JOINs if present
    if (query.joins) {
      this.validateJoins(query.joins);
    }

    // Validate WHERE conditions
    if (query.where) {
      this.validateWhereConditions(query.where);
    }

    // Validate GROUP BY
    if (query.groupBy) {
      this.validateGroupBy(query.groupBy);
    }

    // Validate ORDER BY
    if (query.orderBy) {
      this.validateOrderBy(query.orderBy);
    }

    // Validate pagination
    if (query.limit !== undefined) {
      this.validatePagination(query.limit, query.offset);
    }
  }

  validateSelectExpressions(selectList) {
    selectList.forEach((expr, index) => {
      if (!expr.type) {
        this.errors.push(
          `SELECT expression at index ${index} must have a type`
        );
        return;
      }

      switch (expr.type) {
        case "column":
          this.validateColumnExpression(expr.column, index);
          break;
        case "aggregate":
          this.validateAggregateExpression(expr.aggregate, index);
          break;
        case "window":
          this.validateWindowExpression(expr.window, index);
          this.complexity += 2; // Window functions add complexity
          break;
        case "case":
          this.validateCaseExpression(expr.case, index);
          this.complexity += 1;
          break;
        case "date":
          this.validateDateExpression(expr.date, index);
          break;
        case "raw":
          this.validateRawExpression(expr.raw, index);
          this.warnings.push(
            `Raw expression at index ${index} bypasses validation`
          );
          break;
        default:
          this.errors.push(
            `Unknown SELECT expression type: ${expr.type} at index ${index}`
          );
      }
    });
  }

  validateColumnExpression(column, index) {
    if (!column || !column.column) {
      this.errors.push(
        `Column expression at index ${index} must have a column name`
      );
      return;
    }

    // Allow asterisk for SELECT *
    if (column.column === "*") {
      return; // Valid for SELECT * expressions
    }

    if (column.table && !this.isValidIdentifier(column.table)) {
      this.errors.push(
        `Invalid table name in column expression at index ${index}`
      );
    }
    if (!this.isValidIdentifier(column.column)) {
      this.errors.push(`Invalid column name in expression at index ${index}`);
    }
  }

  validateAggregateExpression(aggregate, index) {
    const validFunctions = [
      "COUNT",
      "SUM",
      "AVG",
      "MAX",
      "MIN",
      "GROUP_CONCAT",
      "JSON_ARRAYAGG",
      "JSON_OBJECTAGG",
    ];

    if (!aggregate.function || !validFunctions.includes(aggregate.function)) {
      this.errors.push(`Invalid aggregate function at index ${index}`);
    }

    if (aggregate.column) {
      this.validateColumnExpression(aggregate.column, index);
    }

    this.complexity += 1;
  }

  validateWindowExpression(window, index) {
    const validFunctions = [
      "ROW_NUMBER",
      "RANK",
      "DENSE_RANK",
      "LAG",
      "LEAD",
      "FIRST_VALUE",
      "LAST_VALUE",
      "SUM",
      "COUNT",
      "AVG",
      "MAX",
      "MIN",
    ];

    if (
      !window.func ||
      !window.func.function ||
      !validFunctions.includes(window.func.function)
    ) {
      this.errors.push(`Invalid window function at index ${index}`);
    }

    if (!window.alias) {
      this.errors.push(`Window function at index ${index} must have an alias`);
    }
  }

  validateCTEs(ctes) {
    if (!Array.isArray(ctes)) {
      this.errors.push("CTEs must be an array");
      return;
    }

    const cteNames = new Set();
    ctes.forEach((cte, index) => {
      if (!cte.name || !this.isValidIdentifier(cte.name)) {
        this.errors.push(`CTE at index ${index} must have a valid name`);
      }

      if (cteNames.has(cte.name)) {
        this.errors.push(`Duplicate CTE name: ${cte.name}`);
      }
      cteNames.add(cte.name);

      if (!cte.query) {
        this.errors.push(`CTE ${cte.name} must have a query`);
      }

      this.complexity += 2; // CTEs add significant complexity
    });
  }

  validateJoins(joins) {
    joins.forEach((join, index) => {
      const validTypes = ["INNER", "LEFT", "RIGHT", "FULL OUTER"];
      if (!validTypes.includes(join.type)) {
        this.errors.push(`Invalid JOIN type at index ${index}: ${join.type}`);
      }

      if (!join.table || !join.table.table) {
        this.errors.push(`JOIN at index ${index} must have a valid table`);
      }

      if (!join.on || !Array.isArray(join.on) || join.on.length === 0) {
        this.errors.push(`JOIN at index ${index} must have ON conditions`);
      }

      this.complexity += 1;
    });
  }

  validateWhereConditions(where) {
    this.validateConditionRecursive(where, "WHERE");
  }

  validateConditionRecursive(condition, context) {
    if (!condition) return;

    // Handle AND/OR logic
    if (condition.and) {
      condition.and.forEach((subCondition) => {
        this.validateConditionRecursive(subCondition, context);
      });
      return;
    }

    if (condition.or) {
      condition.or.forEach((subCondition) => {
        this.validateConditionRecursive(subCondition, context);
      });
      this.complexity += 1; // OR conditions add complexity
      return;
    }

    // Validate individual condition
    if (condition.operator) {
      const validOperators = [
        "=",
        "!=",
        "<",
        "<=",
        ">",
        ">=",
        "LIKE",
        "NOT LIKE",
        "IN",
        "NOT IN",
        "IS NULL",
        "IS NOT NULL",
        "EXISTS",
        "NOT EXISTS",
      ];
      if (!validOperators.includes(condition.operator)) {
        this.errors.push(
          `Invalid operator in ${context}: ${condition.operator}`
        );
      }

      // Special validation for specific operators
      if (["IN", "NOT IN"].includes(condition.operator) && !condition.values) {
        this.errors.push(
          `${condition.operator} operator requires values array`
        );
      }

      if (
        ["EXISTS", "NOT EXISTS"].includes(condition.operator) &&
        !condition.subquery
      ) {
        this.errors.push(`${condition.operator} operator requires subquery`);
      }
    }
  }

  validateGroupBy(groupBy) {
    if (!Array.isArray(groupBy)) {
      this.errors.push("GROUP BY must be an array");
      return;
    }

    groupBy.forEach((column, index) => {
      this.validateColumnExpression(column, `GROUP BY ${index}`);
    });

    this.complexity += 1;
  }

  validateOrderBy(orderBy) {
    if (!Array.isArray(orderBy)) {
      this.errors.push("ORDER BY must be an array");
      return;
    }

    orderBy.forEach((order, index) => {
      this.validateColumnExpression(order.column, `ORDER BY ${index}`);

      if (order.direction && !["ASC", "DESC"].includes(order.direction)) {
        this.errors.push(
          `Invalid ORDER BY direction at index ${index}: ${order.direction}`
        );
      }
    });
  }

  validateCaseExpression(caseExpr, index) {
    if (!caseExpr || !caseExpr.cases || !Array.isArray(caseExpr.cases)) {
      this.errors.push(
        `CASE expression at index ${index} must have cases array`
      );
      return;
    }

    if (caseExpr.cases.length === 0) {
      this.errors.push(
        `CASE expression at index ${index} must have at least one WHEN clause`
      );
      return;
    }

    caseExpr.cases.forEach((whenCase, caseIndex) => {
      if (!whenCase.when) {
        this.errors.push(
          `CASE expression at index ${index}, WHEN clause ${caseIndex} must have a condition`
        );
      } else {
        this.validateConditionRecursive(
          whenCase.when,
          `CASE ${index} WHEN ${caseIndex}`
        );
      }

      if (whenCase.then === undefined) {
        this.errors.push(
          `CASE expression at index ${index}, WHEN clause ${caseIndex} must have a THEN value`
        );
      }
    });
  }

  validateDateExpression(dateFunc, index) {
    const validFunctions = [
      "DATEDIFF",
      "DATE_ADD",
      "DATE_SUB",
      "NOW",
      "CURDATE",
      "YEAR",
      "MONTH",
      "DAY",
    ];

    if (!dateFunc.function || !validFunctions.includes(dateFunc.function)) {
      this.errors.push(
        `Invalid date function at index ${index}: ${dateFunc.function}`
      );
    }

    if (!dateFunc.args || !Array.isArray(dateFunc.args)) {
      this.errors.push(`Date function at index ${index} must have args array`);
    } else {
      // Validate minimum arguments for specific functions
      const minArgs = {
        DATEDIFF: 2,
        DATE_ADD: 2,
        DATE_SUB: 2,
        NOW: 0,
        CURDATE: 0,
        YEAR: 1,
        MONTH: 1,
        DAY: 1,
      };

      const required = minArgs[dateFunc.function];
      if (required !== undefined && dateFunc.args.length < required) {
        this.errors.push(
          `${dateFunc.function} function at index ${index} requires at least ${required} arguments`
        );
      }
    }
  }

  validateRawExpression(rawExpr, index) {
    if (
      !rawExpr ||
      !rawExpr.expression ||
      typeof rawExpr.expression !== "string"
    ) {
      this.errors.push(
        `Raw expression at index ${index} must have a valid expression string`
      );
    }

    if (rawExpr.expression.trim().length === 0) {
      this.errors.push(`Raw expression at index ${index} cannot be empty`);
    }

    // Check for potentially dangerous SQL keywords in raw expressions
    const dangerousKeywords = [
      "DROP",
      "DELETE",
      "TRUNCATE",
      "ALTER",
      "CREATE",
      "INSERT",
      "UPDATE",
    ];
    const upperExpression = rawExpr.expression.toUpperCase();

    dangerousKeywords.forEach((keyword) => {
      if (upperExpression.includes(keyword)) {
        this.errors.push(
          `Raw expression at index ${index} contains potentially dangerous keyword: ${keyword}`
        );
      }
    });
  }

  validatePagination(limit, offset) {
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
        this.errors.push("LIMIT must be an integer between 1 and 10000");
      }
    }

    if (offset !== undefined) {
      if (!Number.isInteger(offset) || offset < 0) {
        this.errors.push("OFFSET must be a non-negative integer");
      }
    }
  }

  isValidIdentifier(name) {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
  }

  /**
   * Generate SQL from validated query object
   */
  async generateSQL(query) {
    let sql = "";

    // Generate CTEs
    if (query.ctes && query.ctes.length > 0) {
      sql += "WITH ";
      sql += (
        await Promise.all(
          query.ctes.map(async (cte) => {
            const cteSql = await this.generateSQL(cte.query);
            return `${cte.name} AS (\n${cteSql}\n)`;
          })
        )
      ).join(",\n");
      sql += "\n";
    }

    // Generate SELECT
    sql += query.distinct ? "SELECT DISTINCT " : "SELECT ";
    sql += query.select
      .map((expr) => this.generateSelectExpression(expr))
      .join(",\n    ");

    // Generate FROM
    sql += `\nFROM ${this.formatTableReference(query.from)}`;

    // Generate JOINs
    if (query.joins) {
      query.joins.forEach((join) => {
        sql += `\n${join.type} JOIN ${this.formatTableReference(join.table)}`;
        sql += ` ON ${join.on
          .map((condition) => this.generateJoinCondition(condition))
          .join(" AND ")}`;
      });
    }

    // Generate WHERE
    if (query.where) {
      sql += `\nWHERE ${this.generateWhereCondition(query.where)}`;
    }

    // Add mandatory user filter with strict validation
    const filterTable =
      this.config.userFilterTable || query.from.alias || query.from.table;
    const userFilter = `${filterTable}.${this.config.userIdField} = ?`;

    // Validate table structure and user ID field existence
    const tableName = `${this.namespace}_${query.from.table}`;
    try {
      // Use DESCRIBE to check table structure
      const describeQuery = `DESCRIBE ${DatabaseService._sanitizeTableName(
        query.from.table
      )}`;
      const tableStructure = await DatabaseService.query(describeQuery);

      // Check if user ID field exists
      const hasUserField = tableStructure.some(
        (col) => col.Field === this.config.userIdField
      );

      if (!hasUserField) {
        throw new Error(
          `Table ${tableName} does not have required ${this.config.userIdField} column for user filtering`
        );
      }

      // Apply user filter
      if (query.where) {
        sql += ` AND ${userFilter}`;
      } else {
        sql += `\nWHERE ${userFilter}`;
      }
    } catch (error) {
      if (error.message.includes("does not have required")) {
        throw error; // Re-throw our validation error
      }
      throw new Error(
        `Failed to validate table structure for ${tableName}: ${error.message}`
      );
    }

    // Generate GROUP BY
    if (query.groupBy) {
      sql += `\nGROUP BY ${query.groupBy
        .map((col) => this.formatColumnReference(col))
        .join(", ")}`;
    }

    // Generate HAVING
    if (query.having) {
      sql += `\nHAVING ${this.generateWhereCondition(query.having)}`;
    }

    // Generate ORDER BY
    if (query.orderBy) {
      sql += `\nORDER BY ${query.orderBy
        .map(
          (order) =>
            `${this.formatColumnReference(order.column)} ${
              order.direction || "ASC"
            }`
        )
        .join(", ")}`;
    }

    // Generate LIMIT/OFFSET
    if (query.limit) {
      sql += `\nLIMIT ${query.limit}`;
      if (query.offset) {
        sql += ` OFFSET ${query.offset}`;
      }
    }

    return sql;
  }

  generateSelectExpression(expr) {
    switch (expr.type) {
      case "column":
        return this.formatColumnReference(expr.column);

      case "aggregate":
        return this.generateAggregateFunction(expr.aggregate);

      case "window":
        return this.generateWindowFunction(expr.window);

      case "case":
        return this.generateCaseExpression(expr.case);

      case "date":
        return this.generateDateFunction(expr.date);

      case "raw":
        return expr.raw.alias
          ? `(${expr.raw.expression}) AS ${expr.raw.alias}`
          : expr.raw.expression;

      default:
        throw new Error(`Unknown SELECT expression type: ${expr.type}`);
    }
  }

  generateAggregateFunction(agg) {
    let sql = agg.function;

    if (agg.distinct) {
      sql += "(DISTINCT ";
    } else {
      sql += "(";
    }

    if (agg.column) {
      sql += this.formatColumnReference(agg.column);
    } else if (agg.function === "COUNT") {
      sql += "*";
    }

    if (agg.function === "GROUP_CONCAT" && agg.separator) {
      sql += ` SEPARATOR '${agg.separator}'`;
    }

    sql += ")";

    if (agg.alias) {
      sql += ` AS ${agg.alias}`;
    }

    return sql;
  }

  generateWindowFunction(window) {
    let sql = `${window.func.function}(`;

    if (window.func.args) {
      sql += window.func.args
        .map((arg) =>
          typeof arg === "object" ? this.formatColumnReference(arg) : arg
        )
        .join(", ");
    }

    sql += ") OVER (";

    if (window.func.partitionBy) {
      sql += `PARTITION BY ${window.func.partitionBy
        .map((col) => this.formatColumnReference(col))
        .join(", ")}`;
    }

    if (window.func.orderBy) {
      if (window.func.partitionBy) sql += " ";
      sql += `ORDER BY ${window.func.orderBy
        .map(
          (order) =>
            `${this.formatColumnReference(order.column)} ${
              order.direction || "ASC"
            }`
        )
        .join(", ")}`;
    }

    sql += `)`;

    if (window.alias) {
      sql += ` AS ${window.alias}`;
    }

    return sql;
  }

  generateCaseExpression(caseExpr) {
    let sql = "CASE";

    caseExpr.cases.forEach((when) => {
      sql += ` WHEN ${this.generateWhereCondition(when.when)} THEN `;
      sql +=
        typeof when.then === "object"
          ? this.formatColumnReference(when.then)
          : `'${when.then}'`;
    });

    if (caseExpr.else !== undefined) {
      sql += ` ELSE `;
      sql +=
        typeof caseExpr.else === "object"
          ? this.formatColumnReference(caseExpr.else)
          : `'${caseExpr.else}'`;
    }

    sql += " END";

    if (caseExpr.alias) {
      sql += ` AS ${caseExpr.alias}`;
    }

    return sql;
  }

  generateDateFunction(dateFunc) {
    let sql = `${dateFunc.function}(`;
    sql += dateFunc.args
      .map((arg) => {
        if (typeof arg === "object") {
          // Check if it's a nested function call
          if (arg.function && arg.args !== undefined) {
            return this.generateDateFunction(arg);
          }
          // Otherwise it's a column reference
          return this.formatColumnReference(arg);
        } else if (typeof arg === "string") {
          return `'${arg}'`;
        } else {
          return arg;
        }
      })
      .join(", ");
    sql += ")";

    if (dateFunc.alias) {
      sql += ` AS ${dateFunc.alias}`;
    }

    return sql;
  }

  generateWhereCondition(condition) {
    if (condition.and) {
      return `(${condition.and
        .map((c) => this.generateWhereCondition(c))
        .join(" AND ")})`;
    }

    if (condition.or) {
      return `(${condition.or
        .map((c) => this.generateWhereCondition(c))
        .join(" OR ")})`;
    }

    if (
      condition.operator === "EXISTS" ||
      condition.operator === "NOT EXISTS"
    ) {
      return this.generateSQL(condition.subquery).then(
        (subquerySql) => `${condition.operator} (${subquerySql})`
      );
    }

    let sql = this.formatColumnReference(condition.column);
    sql += ` ${condition.operator}`;

    if (["IS NULL", "IS NOT NULL"].includes(condition.operator)) {
      return sql;
    }

    if (["IN", "NOT IN"].includes(condition.operator)) {
      sql += ` (${condition.values.map(() => "?").join(", ")})`;
    } else {
      sql += " ?";
    }

    return sql;
  }

  generateJoinCondition(condition) {
    let sql = this.formatColumnReference(condition.left);
    sql += ` ${condition.operator} `;

    if (typeof condition.right === "object") {
      sql += this.formatColumnReference(condition.right);
    } else {
      sql += "?";
    }

    return sql;
  }

  formatTableReference(table) {
    const tableName = `${this.namespace}_${table.table}`;
    return table.alias ? `${tableName} ${table.alias}` : tableName;
  }

  formatColumnReference(column) {
    let sql = "";
    if (column.table) {
      sql += `${column.table}.`;
    }
    sql += column.column;

    if (column.alias) {
      sql += ` AS ${column.alias}`;
    }

    return sql;
  }

  extractParameters(query) {
    const params = [];

    // Extract parameters from WHERE conditions
    if (query.where) {
      this.extractParametersFromCondition(query.where, params);
    }

    // Extract parameters from JOINs
    if (query.joins) {
      query.joins.forEach((join) => {
        join.on.forEach((condition) => {
          if (typeof condition.right !== "object") {
            params.push(condition.right);
          }
        });
      });
    }

    // Add user_id parameter
    params.push(this.userId);

    return params;
  }

  extractParametersFromCondition(condition, params) {
    if (condition.and) {
      condition.and.forEach((c) =>
        this.extractParametersFromCondition(c, params)
      );
      return;
    }

    if (condition.or) {
      condition.or.forEach((c) =>
        this.extractParametersFromCondition(c, params)
      );
      return;
    }

    if (
      condition.operator === "EXISTS" ||
      condition.operator === "NOT EXISTS"
    ) {
      // Recursively extract from subquery
      const subParams = this.extractParameters(condition.subquery);
      params.push(...subParams);
      return;
    }

    if (["IN", "NOT IN"].includes(condition.operator)) {
      params.push(...condition.values);
    } else if (!["IS NULL", "IS NOT NULL"].includes(condition.operator)) {
      params.push(condition.value);
    }
  }

  getComplexityLevel() {
    if (this.complexity >= 10) return "VERY_HIGH";
    if (this.complexity >= 6) return "HIGH";
    if (this.complexity >= 3) return "MEDIUM";
    return "LOW";
  }
}

module.exports = SQLQueryBuilder;
