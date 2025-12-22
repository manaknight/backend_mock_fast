const { z } = require('zod');
const DatabaseService = require('./DatabaseService');

/**
 * SchemaIntelligenceService - Automatically generates everything from Zod schemas
 *
 * One source of truth: Define a Zod schema → Get SQL tables, mocks, docs, validation, tests
 */
class SchemaIntelligenceService {
  constructor() {
    this.generatedSchemas = new Map();
    this.lifecycleHooks = new Map();
  }

  /**
   * Register a schema for intelligence generation
   * @param {string} resourceName - e.g., 'orders', 'users'
   * @param {z.ZodSchema} schema - Zod schema definition
   * @param {Object} options - Additional options
   */
  registerSchema(resourceName, schema, options = {}) {
    this.generatedSchemas.set(resourceName, {
      schema,
      options,
      generated: this.generateAll(resourceName, schema, options)
    });

    // Register lifecycle hooks if provided
    if (options.hooks) {
      this.registerHooks(resourceName, options.hooks);
    }
  }

  /**
   * Generate everything from a Zod schema
   */
  generateAll(resourceName, schema, options = {}) {
    const schemaAnalysis = this.analyzeSchema(schema);

    return {
      sql: this.generateSQLDDL(resourceName, schemaAnalysis, options),
      indexes: this.generateIndexSuggestions(resourceName, schemaAnalysis),
      mocks: this.generateMockGenerators(resourceName, schemaAnalysis),
      openapi: this.generateOpenAPISpec(resourceName, schemaAnalysis),
      validation: this.generateValidationMiddleware(schema),
      fixtures: this.generateTestFixtures(resourceName, schemaAnalysis),
      metadata: schemaAnalysis
    };
  }

  /**
   * Analyze Zod schema structure
   */
  analyzeSchema(schema) {
    const analysis = {
      fields: [],
      relationships: [],
      constraints: [],
      types: new Map()
    };

    // Walk through schema shape
    if (schema._def && schema._def.shape) {
      Object.entries(schema._def.shape).forEach(([fieldName, fieldSchema]) => {
        const fieldAnalysis = this.analyzeField(fieldName, fieldSchema);
        analysis.fields.push(fieldAnalysis);
        analysis.types.set(fieldName, fieldAnalysis);
      });
    }

    return analysis;
  }

  /**
   * Analyze individual field
   */
  analyzeField(fieldName, fieldSchema) {
    const field = {
      name: fieldName,
      type: 'unknown',
      nullable: false,
      constraints: [],
      relationships: []
    };

    const def = fieldSchema._def;

    // Determine field type
    if (def.typeName === 'ZodString') {
      field.type = 'VARCHAR';
      if (def.checks) {
        const uuidCheck = def.checks.find(c => c.kind === 'uuid');
        const emailCheck = def.checks.find(c => c.kind === 'email');
        if (uuidCheck) {
          field.type = 'VARCHAR(36)';
          field.constraints.push('PRIMARY KEY');
        } else if (emailCheck) {
          field.type = 'VARCHAR(255)';
        } else {
          field.type = 'VARCHAR(255)';
        }
      }
    } else if (def.typeName === 'ZodNumber') {
      field.type = 'DECIMAL(10,2)';
      if (def.checks) {
        const intCheck = def.checks.find(c => c.kind === 'int');
        if (intCheck) {
          field.type = 'INT';
        }
      }
    } else if (def.typeName === 'ZodEnum') {
      const values = def.values.map(v => `'${v}'`).join(', ');
      field.type = `ENUM(${values})`;
    } else if (def.typeName === 'ZodArray') {
      // This indicates a relationship - handled separately
      field.type = 'RELATIONSHIP';
      field.relationship = this.analyzeRelationship(fieldName, def);
    } else if (def.typeName === 'ZodOptional') {
      return this.analyzeField(fieldName, def.innerType);
    }

    // Check for nullability
    if (def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable') {
      field.nullable = true;
    }

    // Common timestamp patterns
    if (fieldName.toLowerCase().includes('created') || fieldName.toLowerCase().includes('updated')) {
      field.type = 'TIMESTAMP';
      field.default = 'CURRENT_TIMESTAMP';
    }

    return field;
  }

  /**
   * Analyze relationship fields
   */
  analyzeRelationship(fieldName, arrayDef) {
    const itemSchema = arrayDef.type;
    if (itemSchema._def && itemSchema._def.shape) {
      return {
        type: 'one-to-many',
        relatedResource: fieldName.replace(/s$/, ''), // Remove plural 's'
        fields: Object.keys(itemSchema._def.shape)
      };
    }
    return null;
  }

  /**
   * Generate SQL DDL from schema analysis
   */
  generateSQLDDL(resourceName, analysis, options = {}) {
    const { tenantId } = options;
    const tableName = tenantId ? `${tenantId}_${resourceName}` : resourceName;

    let ddl = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (\n`;

    const columns = [];
    let primaryKey = null;

    analysis.fields.forEach(field => {
      if (field.type === 'RELATIONSHIP') return; // Skip relationship fields for main table

      let columnDef = `  \`${field.name}\` ${field.type}`;

      if (!field.nullable && !field.constraints.includes('PRIMARY KEY')) {
        columnDef += ' NOT NULL';
      }

      if (field.default) {
        columnDef += ` DEFAULT ${field.default}`;
      }

      field.constraints.forEach(constraint => {
        columnDef += ` ${constraint}`;
      });

      columns.push(columnDef);

      if (field.constraints.includes('PRIMARY KEY')) {
        primaryKey = field.name;
      }
    });

    ddl += columns.join(',\n');
    ddl += '\n);';

    // Generate related tables for relationships
    const relatedTables = [];
    analysis.fields.forEach(field => {
      if (field.type === 'RELATIONSHIP' && field.relationship) {
        const relatedTableName = tenantId ?
          `${tenantId}_${field.relationship.relatedResource}s` :
          `${field.relationship.relatedResource}s`;

        let relatedDDL = `\n\nCREATE TABLE IF NOT EXISTS \`${relatedTableName}\` (
  \`id\` VARCHAR(36) PRIMARY KEY,
  \`${resourceName.slice(0, -1)}_id\` VARCHAR(36) NOT NULL,
  ${field.relationship.fields.map(f => `\`${f}\` VARCHAR(255)`).join(',\n  ')},
  FOREIGN KEY (\`${resourceName.slice(0, -1)}_id\`) REFERENCES \`${tableName}\`(\`id\`)
);`;

        relatedTables.push(relatedDDL);
      }
    });

    return ddl + relatedTables.join('');
  }

  /**
   * Generate index suggestions
   */
  generateIndexSuggestions(resourceName, analysis) {
    const indexes = [];

    analysis.fields.forEach(field => {
      const fieldName = field.name.toLowerCase();

      // Index foreign keys
      if (fieldName.includes('id') && fieldName !== 'id') {
        indexes.push({
          name: `idx_${resourceName}_${field.name}`,
          columns: [field.name],
          type: 'BTREE'
        });
      }

      // Index status fields
      if (fieldName === 'status') {
        indexes.push({
          name: `idx_${resourceName}_status`,
          columns: [field.name],
          type: 'BTREE'
        });
      }

      // Index timestamps
      if (fieldName.includes('created') || fieldName.includes('updated')) {
        indexes.push({
          name: `idx_${resourceName}_${field.name}`,
          columns: [field.name],
          type: 'BTREE'
        });
      }
    });

    return indexes;
  }

  /**
   * Generate mock data generators
   */
  generateMockGenerators(resourceName, analysis) {
    const generators = {
      [resourceName.slice(0, -1)]: () => {
        const mock = {};

        analysis.fields.forEach(field => {
          if (field.type === 'RELATIONSHIP') return;

          mock[field.name] = this.generateMockValue(field);
        });

        return mock;
      },

      [`${resourceName.slice(0, -1)}List`]: (count = 5) => {
        const mocks = [];
        for (let i = 0; i < count; i++) {
          mocks.push(generators[resourceName.slice(0, -1)]());
        }
        return mocks;
      }
    };

    return generators;
  }

  /**
   * Generate mock value for a field
   */
  generateMockValue(field) {
    const name = field.name.toLowerCase();

    if (name === 'id') {
      return this.generateUUID();
    }

    if (name.includes('email')) {
      return `user${Math.floor(Math.random() * 1000)}@example.com`;
    }

    if (name.includes('name')) {
      return `Sample ${field.name}`;
    }

    if (field.type.startsWith('VARCHAR')) {
      return `sample_${name}_${Math.floor(Math.random() * 1000)}`;
    }

    if (field.type === 'INT' || field.type.startsWith('DECIMAL')) {
      return Math.floor(Math.random() * 1000) + 1;
    }

    if (field.type.startsWith('ENUM')) {
      const values = field.type.match(/ENUM\((.+)\)/)[1].split(',').map(v => v.replace(/'/g, ''));
      return values[Math.floor(Math.random() * values.length)];
    }

    if (field.type === 'TIMESTAMP') {
      return new Date().toISOString();
    }

    return `mock_${name}`;
  }

  /**
   * Generate OpenAPI specification
   */
  generateOpenAPISpec(resourceName, analysis) {
    const schemaName = resourceName.charAt(0).toUpperCase() + resourceName.slice(1, -1);

    const properties = {};
    analysis.fields.forEach(field => {
      if (field.type === 'RELATIONSHIP') return;

      properties[field.name] = {
        type: this.mapSQLTypeToOpenAPI(field.type),
        description: `${field.name} field`
      };
    });

    return {
      components: {
        schemas: {
          [schemaName]: {
            type: 'object',
            properties,
            required: analysis.fields.filter(f => !f.nullable && f.type !== 'RELATIONSHIP').map(f => f.name)
          }
        }
      }
    };
  }

  /**
   * Generate validation middleware
   */
  generateValidationMiddleware(schema) {
    return (req, res, next) => {
      try {
        if (req.body) {
          schema.parse(req.body);
        }
        next();
      } catch (error) {
        res.status(400).json({
          success: false,
          error: 'Validation Failed',
          details: error.errors
        });
      }
    };
  }

  /**
   * Generate test fixtures
   */
  generateTestFixtures(resourceName, analysis) {
    return {
      validData: [this.generateMockGenerators(resourceName, analysis)[resourceName.slice(0, -1)]()],
      invalidData: [
        { ...this.generateMockGenerators(resourceName, analysis)[resourceName.slice(0, -1)](), id: null }, // Invalid ID
        {} // Empty object
      ]
    };
  }

  /**
   * Register lifecycle hooks
   */
  registerHooks(resourceName, hooks) {
    this.lifecycleHooks.set(resourceName, hooks);
  }

  /**
   * Execute lifecycle hook
   */
  async executeHook(resourceName, hookName, data, context = {}) {
    const hooks = this.lifecycleHooks.get(resourceName);
    if (hooks && hooks[hookName]) {
      return await hooks[hookName](data, context);
    }
  }

  /**
   * Utility methods
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  mapSQLTypeToOpenAPI(sqlType) {
    if (sqlType.startsWith('VARCHAR')) return 'string';
    if (sqlType === 'INT') return 'integer';
    if (sqlType.startsWith('DECIMAL')) return 'number';
    if (sqlType === 'TIMESTAMP') return 'string';
    if (sqlType.startsWith('ENUM')) return 'string';
    return 'string';
  }

  /**
   * Get generated schema data
   */
  getGeneratedSchema(resourceName) {
    return this.generatedSchemas.get(resourceName);
  }

  /**
   * Apply generated SQL to database
   */
  async applySQLToDatabase(resourceName, tenantId) {
    const generated = this.getGeneratedSchema(resourceName);
    if (!generated) throw new Error(`Schema not found: ${resourceName}`);

    const sql = generated.generated.sql;
    const statements = sql.split(';').filter(s => s.trim());

    for (const statement of statements) {
      if (statement.trim()) {
        await DatabaseService.query(statement + ';');
      }
    }

    console.log(`✅ Applied SQL schema for ${resourceName}`);
  }
}

module.exports = new SchemaIntelligenceService();
