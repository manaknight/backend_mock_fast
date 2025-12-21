const fs = require('fs');
const path = require('path');
const RouterFactory = require('./RouterFactory');
const DatabaseService = require('../services/DatabaseService');
const TenantDatabaseService = require('./TenantDatabaseService');

/**
 * TenantManager - Manages the dynamic loading of multiple projects (tenants).
 */
class TenantManager {
  constructor(app) {
    this.app = app;
    this.projects = new Map();
    this.projectsDir = path.join(process.cwd(), 'projects');
  }

  /**
   * Initializes and loads all projects from the projects directory.
   */
  async loadProjects() {
    if (!fs.existsSync(this.projectsDir)) {
      console.log('⚠️  No projects directory found.');
      return;
    }

    const projectFolders = fs.readdirSync(this.projectsDir).filter(f => {
      return fs.statSync(path.join(this.projectsDir, f)).isDirectory();
    });

    console.log(`🔍 Loading ${projectFolders.length} projects...`);

    for (const projectId of projectFolders) {
      try {
        await this.loadProject(projectId);
      } catch (error) {
        console.error(`  ❌ Failed to load project "${projectId}":`, error.message);
      }
    }
  }

  /**
   * Loads a single project.
   */
  async loadProject(projectId) {
    const projectPath = path.join(this.projectsDir, projectId);

    // 1. Load Config (Secrets/Env - in a real app, this might come from a DB)
    const configPath = path.join(projectPath, 'config.json');
    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    // 2. Setup Namespaced Database
    const tenantDb = new TenantDatabaseService(DatabaseService, projectId);

    // 3. Load Routes
    const routesPath = path.join(projectPath, 'routes');
    if (fs.existsSync(routesPath)) {
      const routeFiles = fs.readdirSync(routesPath).filter(f => f.endsWith('Routes.js'));

      for (const file of routeFiles) {
        const routeDef = require(path.join(routesPath, file));

        // Register routes under /api/:projectId/
        // Pass the tenantDb to the RouterFactory so it can be injected into 'real' calls
        this.app.use(`/api/${projectId}`, RouterFactory.create(routeDef, { tenantDb, projectId }));
      }
    }

    this.projects.set(projectId, { config, tenantDb });
    console.log(`  ✅ Project "${projectId}" loaded (Namespace: ${projectId}_)`);
  }
}

module.exports = TenantManager;
