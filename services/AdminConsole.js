const express = require('express');
const DatabaseService = require('./DatabaseService');
const SchemaIntelligenceService = require('./SchemaIntelligenceService');
const TenantManager = require('../core/TenantManager');
const auth = require('../middleware/auth');

/**
 * AdminConsole - Built-in web UI for debugging and operations
 *
 * Provides a complete admin interface showing:
 * - Tenants and projects
 * - Routes and schemas
 * - Mock vs Real toggles
 * - Live database rows
 * - Request logs and latency simulation
 * - Schema management
 */
class AdminConsole {
  constructor(app) {
    this.app = app;
    this.requestLogs = [];
    this.maxLogs = 1000;
    this.rateLimits = new Map(); // Simple in-memory rate limiter
    this.setupRoutes();
  }

  /**
   * Setup admin console routes
   */
  setupRoutes() {
    // Admin authentication middleware - require any admin role for admin routes
    const adminAuth = auth.requireAnyAdmin;
    const adminRateLimit = this.createRateLimit(10, 60000); // 10 requests per minute for admin

    // Main admin console
    this.app.get('/admin', adminAuth, adminRateLimit, (req, res) => this.renderAdminDashboard(req, res));

    // API endpoints for admin operations
    this.app.get('/admin/api/tenants', adminAuth, adminRateLimit, (req, res) => this.getTenantsData(req, res));
    this.app.get('/admin/api/routes', adminAuth, adminRateLimit, (req, res) => this.getRoutesData(req, res));
    this.app.get('/admin/api/schemas', adminAuth, adminRateLimit, (req, res) => this.getSchemasData(req, res));
    this.app.get('/admin/api/logs', adminAuth, adminRateLimit, (req, res) => this.getLogsData(req, res));
    this.app.get('/admin/api/database/:tenant/:table', adminAuth, adminRateLimit, (req, res) => this.getTableData(req, res));

    // Admin operations (more restrictive rate limiting)
    const adminActionRateLimit = this.createRateLimit(5, 300000); // 5 actions per 5 minutes
    this.app.post('/admin/api/toggle-mock', adminAuth, adminActionRateLimit, (req, res) => this.toggleMockMode(req, res));
    this.app.post('/admin/api/set-latency', adminAuth, adminActionRateLimit, (req, res) => this.setLatency(req, res));
    this.app.post('/admin/api/generate-schema', adminAuth, adminActionRateLimit, (req, res) => this.generateSchema(req, res));

    // Request logging middleware
    this.app.use((req, res, next) => this.logRequest(req, res, next));
  }

  /**
   * Render main admin dashboard
   */
  async renderAdminDashboard(req, res) {
    try {
      const data = await this.getDashboardData(req);

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Console - Quick Fast Hybrid API</title>
    <style>
        ${this.getAdminStyles()}
    </style>
</head>
<body>
        <div class="admin-container">
        <div class="security-banner">
            <strong>🔐 SECURE ADMIN ACCESS</strong> - All actions are logged and monitored
        </div>
        <header class="admin-header">
            <h1>🚀 Quick Fast Hybrid API Admin Console</h1>
            <div class="header-info">
                <span class="user-info">👤 ${req.user?.email || 'Admin'} (${req.user?.role || 'Admin'})</span>
                <span class="tenant-info">${req.user?.role === 'SuperAdmin' ? '🌐 Global Admin' : `🏢 Tenant: ${req.user?.tenantId || 'Unknown'}`}</span>
                <span class="security-notice">🔒 Admin Access Required</span>
            </div>
            <div class="header-controls">
                <div class="control-group">
                    <label>Mock Mode:</label>
                    <button id="toggleMock" class="btn ${data.mockMode ? 'btn-success' : 'btn-secondary'}">
                        ${data.mockMode ? '🛠️ ON' : '🚀 OFF'}
                    </button>
                </div>
                <div class="control-group">
                    <label>Latency (ms):</label>
                    <input type="number" id="latencyInput" value="${data.mockLatency}" min="0" max="5000">
                    <button id="setLatency" class="btn btn-primary">Set</button>
                </div>
            </div>
        </header>

        <div class="dashboard-grid">
            <div class="dashboard-card">
                <h3>📊 System Status</h3>
                <div class="metric-grid">
                    <div class="metric">
                        <span class="metric-value">${data.tenantsCount}</span>
                        <span class="metric-label">Tenants</span>
                    </div>
                    <div class="metric">
                        <span class="metric-value">${data.routesCount}</span>
                        <span class="metric-label">Routes</span>
                    </div>
                    <div class="metric">
                        <span class="metric-value">${data.schemasCount}</span>
                        <span class="metric-label">Schemas</span>
                    </div>
                    <div class="metric">
                        <span class="metric-value">${data.requestCount}</span>
                        <span class="metric-label">Requests</span>
                    </div>
                </div>
            </div>

            <div class="dashboard-card">
                <h3>🏗️ Tenants & Projects</h3>
                <div id="tenantsList" class="list-container">
                    ${data.tenants.map(tenant => `
                        <div class="list-item">
                            <strong>${tenant.id}</strong>
                            <span class="badge">${tenant.routesCount} routes</span>
                            <button onclick="viewTenant('${tenant.id}')" class="btn btn-sm">View</button>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="dashboard-card">
                <h3>🛣️ Routes</h3>
                <div id="routesList" class="list-container">
                    ${data.routes.slice(0, 10).map(route => `
                        <div class="list-item">
                            <span class="method ${route.method}">${route.method}</span>
                            <code>${route.path}</code>
                            <span class="badge">${route.source}</span>
                        </div>
                    `).join('')}
                    ${data.routes.length > 10 ? `<div class="list-item">... and ${data.routes.length - 10} more</div>` : ''}
                </div>
            </div>

            <div class="dashboard-card">
                <h3>📋 Schemas</h3>
                <div id="schemasList" class="list-container">
                    ${data.schemas.map(schema => `
                        <div class="list-item">
                            <strong>${schema.name}</strong>
                            <span class="badge">${schema.fields} fields</span>
                            <button onclick="generateSchema('${schema.name}')" class="btn btn-sm">Generate SQL</button>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="dashboard-card">
                <h3>📊 Recent Requests</h3>
                <div id="logsList" class="logs-container">
                    ${data.recentLogs.map(log => `
                        <div class="log-entry ${log.status >= 400 ? 'error' : ''}">
                            <span class="timestamp">${log.timestamp}</span>
                            <span class="method ${log.method}">${log.method}</span>
                            <span class="path">${log.path}</span>
                            <span class="status status-${Math.floor(log.status / 100)}">${log.status}</span>
                            <span class="duration">${log.duration}ms</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="dashboard-card">
                <h3>🗃️ Database Browser</h3>
                <div class="db-browser">
                    <select id="tenantSelect" onchange="loadTables()">
                        <option value="">Select Tenant</option>
                        ${data.tenants.map(tenant => `<option value="${tenant.id}">${tenant.id}</option>`).join('')}
                    </select>
                    <select id="tableSelect" onchange="loadTableData()">
                        <option value="">Select Table</option>
                    </select>
                    <div id="tableData" class="table-preview">
                        Select a tenant and table to view data
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        ${this.getAdminScripts()}
    </script>
</body>
</html>`;

      res.send(html);
    } catch (error) {
      console.error('Admin dashboard error:', error);
      res.status(500).send('Admin console error');
    }
  }

  /**
   * Get dashboard data
   */
  async getDashboardData(req) {
    const isSuperAdmin = req.user.role === 'SuperAdmin';
    const userTenantId = req.user.tenantId;

    // Filter tenants based on user role
    let tenantIds = Array.from(TenantManager.projects.keys());
    if (!isSuperAdmin) {
      // Regular admins can only see their own tenant
      tenantIds = tenantIds.filter(id => id === userTenantId);
    }

    const tenants = tenantIds.map(id => ({
      id,
      routesCount: this.getRoutesCountForTenant(id)
    }));

    const schemas = Array.from(SchemaIntelligenceService.generatedSchemas.keys()).map(name => {
      const schema = SchemaIntelligenceService.getGeneratedSchema(name);
      return {
        name,
        fields: schema.generated.metadata.fields.length
      };
    });

    return {
      mockMode: process.env.MOCK_MODE === 'true',
      mockLatency: parseInt(process.env.MOCK_LATENCY) || 0,
      tenantsCount: tenants.length,
      routesCount: this.getTotalRoutesCount(),
      schemasCount: schemas.length,
      requestCount: this.requestLogs.length,
      tenants,
      routes: await this.getAllRoutes(),
      schemas,
      recentLogs: this.requestLogs.slice(-20).reverse()
    };
  }

  /**
   * Get tenants data for API
   */
  async getTenantsData(req, res) {
    try {
      const isSuperAdmin = req.user.role === 'SuperAdmin';
      const userTenantId = req.user.tenantId;

      let tenantIds = Array.from(TenantManager.projects.keys());
      if (!isSuperAdmin) {
        // Regular admins can only see their own tenant
        tenantIds = tenantIds.filter(id => id === userTenantId);
      }

      const tenants = tenantIds.map(id => ({
        id,
        routesCount: this.getRoutesCountForTenant(id),
        config: isSuperAdmin ? TenantManager.projects.get(id).config : undefined // Hide config from tenant admins
      }));

      res.json({ success: true, data: tenants });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get routes data for API
   */
  async getRoutesData(req, res) {
    try {
      const isSuperAdmin = req.user.role === 'SuperAdmin';
      const userTenantId = req.user.tenantId;

      const allRoutes = await this.getAllRoutes();

      // Filter routes based on user role
      const routes = isSuperAdmin
        ? allRoutes // SuperAdmins see all routes
        : allRoutes.filter(route =>
          route.source === 'shared' || route.source === userTenantId
        ); // Tenant admins see shared routes + their tenant's routes

      res.json({ success: true, data: routes });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get schemas data for API
   */
  getSchemasData(req, res) {
    try {
      const schemas = Array.from(SchemaIntelligenceService.generatedSchemas.entries()).map(([name, data]) => ({
        name,
        schema: data.schema,
        generated: {
          sql: data.generated.sql,
          indexes: data.generated.indexes,
          openapi: data.generated.openapi
        },
        metadata: data.generated.metadata
      }));
      res.json({ success: true, data: schemas });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get logs data for API
   */
  getLogsData(req, res) {
    res.json({
      success: true,
      data: this.requestLogs.slice(-100).reverse()
    });
  }

  /**
   * Get table data for database browser
   */
  async getTableData(req, res) {
    try {
      const { tenant, table } = req.params;
      const limit = parseInt(req.query.limit) || 50;

      // Check tenant access permissions
      const isSuperAdmin = req.user.role === 'SuperAdmin';
      const userTenantId = req.user.tenantId;

      if (!isSuperAdmin && tenant !== userTenantId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'You can only access your own tenant\'s data'
        });
      }

      // Get tenant database service
      const tenantData = TenantManager.projects.get(tenant);
      if (!tenantData) {
        return res.status(404).json({ success: false, error: 'Tenant not found' });
      }

      const db = tenantData.tenantDb;
      const data = await db.find(table, { limit });

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Toggle mock mode
   */
  toggleMockMode(req, res) {
    try {
      const currentMode = process.env.MOCK_MODE === 'true';
      const newMode = !currentMode;
      process.env.MOCK_MODE = newMode.toString();

      // Log admin action
      const tenantInfo = req.user.role === 'SuperAdmin' ? 'Global' : `Tenant: ${req.user.tenantId}`;
      console.log(`🔐 ADMIN ACTION: ${req.user.email} (${req.user.role}) [${tenantInfo}] ${newMode ? 'enabled' : 'disabled'} mock mode`);

      res.json({
        success: true,
        mockMode: newMode,
        message: `Mock mode ${newMode ? 'enabled' : 'disabled'}`
      });
    } catch (error) {
      console.error(`❌ ADMIN ERROR: Failed to toggle mock mode by ${req.user?.email}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Set latency
   */
  setLatency(req, res) {
    try {
      const latency = Math.min(Math.max(parseInt(req.body.latency) || 0, 0), 10000); // Max 10 seconds
      process.env.MOCK_LATENCY = latency.toString();

      // Log admin action
      const tenantInfo = req.user.role === 'SuperAdmin' ? 'Global' : `Tenant: ${req.user.tenantId}`;
      console.log(`🔐 ADMIN ACTION: ${req.user.email} (${req.user.role}) [${tenantInfo}] set mock latency to ${latency}ms`);

      res.json({
        success: true,
        latency,
        message: `Mock latency set to ${latency}ms`
      });
    } catch (error) {
      console.error(`❌ ADMIN ERROR: Failed to set latency by ${req.user?.email}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Generate schema SQL
   */
  async generateSchema(req, res) {
    try {
      const { resourceName, tenantId } = req.body;

      // Check tenant access permissions
      const isSuperAdmin = req.user.role === 'SuperAdmin';
      const userTenantId = req.user.tenantId;

      if (!isSuperAdmin && tenantId !== userTenantId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'You can only generate schemas for your own tenant'
        });
      }

      // Log admin action
      const tenantInfo = req.user.role === 'SuperAdmin' ? 'Global' : `Tenant: ${req.user.tenantId}`;
      console.log(`🔐 ADMIN ACTION: ${req.user.email} (${req.user.role}) [${tenantInfo}] generated schema for ${resourceName}${tenantId ? ` in tenant ${tenantId}` : ''}`);

      await SchemaIntelligenceService.applySQLToDatabase(resourceName, tenantId);

      res.json({
        success: true,
        message: `Schema generated for ${resourceName}`
      });
    } catch (error) {
      console.error(`❌ ADMIN ERROR: Failed to generate schema by ${req.user?.email}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Request logging middleware
   */
  logRequest(req, res, next) {
    const startTime = Date.now();
    const originalSend = res.send;

    res.send = function (data) {
      const duration = Date.now() - startTime;

      // Log the request
      const logEntry = {
        timestamp: new Date().toLocaleTimeString(),
        method: req.method,
        path: req.path,
        query: req.query,
        status: res.statusCode,
        duration,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      };

      this.requestLogs.push(logEntry);

      // Keep only the most recent logs
      if (this.requestLogs.length > this.maxLogs) {
        this.requestLogs.shift();
      }

      // Call original send
      originalSend.call(this, data);
    }.bind(this);

    next();
  }

  /**
   * Create rate limiting middleware
   * @param {number} maxRequests - Maximum requests allowed
   * @param {number} windowMs - Time window in milliseconds
   */
  createRateLimit(maxRequests, windowMs) {
    return (req, res, next) => {
      const key = `${req.user?.id || req.ip}_${req.path}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Get or create rate limit data for this key
      if (!this.rateLimits.has(key)) {
        this.rateLimits.set(key, []);
      }

      const requests = this.rateLimits.get(key);

      // Remove old requests outside the time window
      const validRequests = requests.filter(timestamp => timestamp > windowStart);
      this.rateLimits.set(key, validRequests);

      // Check if rate limit exceeded
      if (validRequests.length >= maxRequests) {
        console.warn(`🚫 RATE LIMIT EXCEEDED: ${req.user?.email || 'unknown'} (${req.ip}) on ${req.path}`);
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          message: 'Too many admin requests. Please wait before trying again.'
        });
      }

      // Add current request timestamp
      validRequests.push(now);

      next();
    };
  }

  /**
   * Helper methods
   */
  getRoutesCountForTenant(tenantId) {
    try {
      const projectPath = `projects/${tenantId}/routes`;
      const fs = require('fs');
      const path = require('path');

      if (fs.existsSync(path.join(process.cwd(), projectPath))) {
        const files = fs.readdirSync(path.join(process.cwd(), projectPath))
          .filter(f => f.endsWith('Routes.js'));
        return files.length;
      }
    } catch (error) {
      console.error(`Error counting routes for tenant ${tenantId}:`, error);
    }
    return 0;
  }

  getTotalRoutesCount() {
    let count = 0;

    // Count project routes
    Array.from(TenantManager.projects.keys()).forEach(tenantId => {
      count += this.getRoutesCountForTenant(tenantId);
    });

    // Count shared routes
    try {
      const fs = require('fs');
      const path = require('path');
      const routesPath = path.join(process.cwd(), 'routes');

      if (fs.existsSync(routesPath)) {
        const files = fs.readdirSync(routesPath).filter(f => f.endsWith('Routes.js'));
        count += files.length;
      }
    } catch (error) {
      console.error('Error counting shared routes:', error);
    }

    return count;
  }

  async getAllRoutes() {
    const routes = [];

    // Get shared routes
    try {
      const fs = require('fs');
      const path = require('path');
      const routesPath = path.join(process.cwd(), 'routes');

      if (fs.existsSync(routesPath)) {
        const files = fs.readdirSync(routesPath).filter(f => f.endsWith('Routes.js'));
        for (const file of files) {
          const routeDef = require(path.join(routesPath, file));
          routes.push(...routeDef.map(r => ({ ...r, source: 'shared' })));
        }
      }
    } catch (error) {
      console.error('Error loading shared routes:', error);
    }

    // Get project routes
    TenantManager.projects.forEach((data, projectId) => {
      const projectPath = path.join(process.cwd(), 'projects', projectId, 'routes');
      if (fs.existsSync(projectPath)) {
        const files = fs.readdirSync(projectPath).filter(f => f.endsWith('Routes.js'));
        files.forEach(file => {
          const def = require(path.join(projectPath, file));
          routes.push(...def.map(r => ({ ...r, path: `/${projectId}${r.path}`, source: projectId })));
        });
      }
    });

    return routes.map(r => ({
      path: `/api${r.path}`,
      method: r.method || 'GET',
      capability: r.capability,
      source: r.source
    }));
  }

  /**
   * CSS styles for admin console
   */
  getAdminStyles() {
    return `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f9fa; color: #333; }
        .security-banner { background: linear-gradient(90deg, #e74c3c, #c0392b); color: white; padding: 10px 20px; text-align: center; font-weight: bold; border-radius: 4px; margin-bottom: 20px; }
        .admin-container { max-width: 1400px; margin: 0 auto; padding: 20px; }
        .admin-header { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
        .header-info { display: flex; flex-direction: column; align-items: flex-start; }
        .user-info { font-weight: bold; color: #2c3e50; }
        .tenant-info { color: #3498db; font-size: 0.9em; font-weight: bold; margin-left: 10px; }
        .security-notice { color: #e74c3c; font-size: 0.9em; font-weight: bold; }
        .admin-header h1 { color: #2c3e50; }
        .header-controls { display: flex; gap: 20px; }
        .control-group { display: flex; align-items: center; gap: 10px; }
        .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }
        .dashboard-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .dashboard-card h3 { color: #2c3e50; margin-bottom: 15px; border-bottom: 2px solid #ecf0f1; padding-bottom: 10px; }
        .metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
        .metric { text-align: center; padding: 10px; background: #f8f9fa; border-radius: 6px; }
        .metric-value { display: block; font-size: 2em; font-weight: bold; color: #3498db; }
        .metric-label { color: #7f8c8d; font-size: 0.9em; }
        .list-container { max-height: 300px; overflow-y: auto; }
        .list-item { padding: 8px 0; border-bottom: 1px solid #ecf0f1; display: flex; justify-content: space-between; align-items: center; }
        .list-item:last-child { border-bottom: none; }
        .badge { background: #3498db; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; }
        .method { display: inline-block; padding: 2px 6px; border-radius: 4px; color: white; font-weight: bold; font-size: 0.8em; min-width: 50px; text-align: center; }
        .GET { background: #27ae60; }
        .POST { background: #3498db; }
        .PUT { background: #f39c12; }
        .DELETE { background: #e74c3c; }
        .logs-container { max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 0.9em; }
        .log-entry { padding: 4px 0; border-bottom: 1px solid #ecf0f1; display: flex; gap: 10px; align-items: center; }
        .log-entry.error { background: #fee; }
        .timestamp { color: #7f8c8d; min-width: 80px; }
        .status { min-width: 40px; text-align: center; padding: 1px 4px; border-radius: 3px; }
        .status-2 { background: #d4edda; color: #155724; }
        .status-3 { background: #d1ecf1; color: #0c5460; }
        .status-4 { background: #f8d7da; color: #721c24; }
        .status-5 { background: #f8d7da; color: #721c24; }
        .duration { color: #7f8c8d; min-width: 60px; }
        .db-browser { display: flex; flex-direction: column; gap: 10px; }
        .table-preview { max-height: 200px; overflow-y: auto; background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 0.8em; }
        .btn { padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em; }
        .btn-primary { background: #007bff; color: white; }
        .btn-success { background: #28a745; color: white; }
        .btn-secondary { background: #6c757d; color: white; }
        .btn-sm { padding: 2px 6px; font-size: 0.8em; }
        .btn:hover { opacity: 0.9; }
        select { padding: 4px; border: 1px solid #ddd; border-radius: 4px; }
    `;
  }

  /**
   * JavaScript for admin console
   */
  getAdminScripts() {
    return `
        // Toggle mock mode
        document.getElementById('toggleMock').addEventListener('click', async () => {
            const response = await fetch('/admin/api/toggle-mock', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                location.reload();
            }
        });

        // Set latency
        document.getElementById('setLatency').addEventListener('click', async () => {
            const latency = document.getElementById('latencyInput').value;
            const response = await fetch('/admin/api/set-latency', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ latency })
            });
            const result = await response.json();
            if (result.success) {
                alert(result.message);
            }
        });

        // Load tables for tenant
        async function loadTables() {
            const tenant = document.getElementById('tenantSelect').value;
            const tableSelect = document.getElementById('tableSelect');
            tableSelect.innerHTML = '<option value="">Select Table</option>';

            if (!tenant) return;

            try {
                // This would need to be implemented to get available tables for a tenant
                // For now, we'll show common table names
                const commonTables = ['users', 'orders', 'products', 'transactions'];
                commonTables.forEach(table => {
                    const option = document.createElement('option');
                    option.value = table;
                    option.textContent = table;
                    tableSelect.appendChild(option);
                });
            } catch (error) {
                console.error('Error loading tables:', error);
            }
        }

        // Load table data
        async function loadTableData() {
            const tenant = document.getElementById('tenantSelect').value;
            const table = document.getElementById('tableSelect').value;
            const tableData = document.getElementById('tableData');

            if (!tenant || !table) {
                tableData.innerHTML = 'Select a tenant and table to view data';
                return;
            }

            try {
                const response = await fetch(\`/admin/api/database/\${tenant}/\${table}?limit=10\`);
                const result = await response.json();

                if (result.success && result.data.length > 0) {
                    const headers = Object.keys(result.data[0]).join(' | ');
                    const rows = result.data.map(row =>
                        Object.values(row).map(val =>
                            String(val).substring(0, 20)
                        ).join(' | ')
                    ).join('\\n');

                    tableData.innerHTML = \`<pre>\${headers}\\n\${'='.repeat(headers.length)}\\n\${rows}</pre>\`;
                } else {
                    tableData.innerHTML = 'No data found';
                }
            } catch (error) {
                tableData.innerHTML = 'Error loading data: ' + error.message;
            }
        }

        // Generate schema
        async function generateSchema(resourceName) {
            if (confirm(\`Generate SQL schema for \${resourceName}?\`)) {
                try {
                    const response = await fetch('/admin/api/generate-schema', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ resourceName })
                    });
                    const result = await response.json();
                    alert(result.message);
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }
        }

        // View tenant details
        function viewTenant(tenantId) {
            window.open(\`/admin/tenant/\${tenantId}\`, '_blank');
        }

        // Auto-refresh logs every 5 seconds
        setInterval(async () => {
            try {
                const response = await fetch('/admin/api/logs');
                const result = await response.json();
                if (result.success) {
                    updateLogs(result.data.slice(0, 20));
                }
            } catch (error) {
                console.error('Error refreshing logs:', error);
            }
        }, 5000);

        function updateLogs(logs) {
            const logsContainer = document.getElementById('logsList');
            logsContainer.innerHTML = logs.map(log => \`
                <div class="log-entry \${log.status >= 400 ? 'error' : ''}">
                    <span class="timestamp">\${log.timestamp}</span>
                    <span class="method \${log.method}">\${log.method}</span>
                    <span class="path">\${log.path}</span>
                    <span class="status status-\${Math.floor(log.status/100)}">\${log.status}</span>
                    <span class="duration">\${log.duration}ms</span>
                </div>
            \`).join('');
        }
    `;
  }
}

module.exports = AdminConsole;
