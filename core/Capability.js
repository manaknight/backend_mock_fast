// Role-based capabilities configuration
// SuperAdmin: Global system administration (all tenants)
// Admin: Tenant-scoped administration (own tenant only)
// Member: Basic user access
// Support: Enhanced user support access
const capabilities = {
  superadmin: {
    can: [
      '*',
      // All global admin capabilities
      'system:admin',
      'tenants:manage',
      'global:settings',
      'cross_tenant:access'
    ],
  },
  admin: {
    can: [
      // Tenant-scoped admin capabilities
      'tenant:admin',
      'tenant:settings',
      'tenant:users:manage',
      'tenant:data:manage',
      'tenant:schemas:manage',
      'tenant:routes:manage',
      'tenant:monitoring',
      // Can access their own tenant's admin console
      'admin_console:tenant'
    ],
  },
  member: {
    can: [
      // Support tickets
      'support:tickets:read',
      'support:tickets:create',
      'support:messages:read',
      'support:messages:create',

      // Affiliate (own affiliate only)
      'affiliate:read',
      'affiliate:convert',

      // Billing
      'billing:subscription:read',
      'billing:checkout:create',
      'billing:cancel:create',

      // Notifications
      'notifications:read',
      'notifications:mark_read',

      // Coupons
      'coupons:read',
      'coupons:apply',

      // Sponsors
      'sponsors:read',
      'sponsors:apply',

      // Advisory
      'advisory:read',
      'advisory:requests:read',
      'advisory:requests:create',

      // Opportunities
      'opportunities:read',
      'opportunities:detail',
      'opportunities:nda:sign',
      'opportunities:proposals:create',
      'opportunities:chat:read',
      'opportunities:chat:create',

      // Fundraising
      'fundraising:create',

      // Jackpot
      'jackpot:enter',

      // Education
      'education:read',
      'education:proposals:create',
    ],
  },
  support: {
    can: [
      // All member capabilities
      'support:tickets:read',
      'support:tickets:create',
      'support:messages:read',
      'support:messages:create',
      'affiliate:read',
      'affiliate:convert',
      'billing:subscription:read',
      'billing:checkout:create',
      'billing:cancel:create',
      'notifications:read',
      'notifications:mark_read',
      'coupons:read',
      'coupons:apply',
      'sponsors:read',
      'sponsors:apply',
      'advisory:read',
      'advisory:requests:read',
      'advisory:requests:create',
      'opportunities:read',
      'opportunities:detail',
      'opportunities:nda:sign',
      'opportunities:proposals:create',
      'opportunities:chat:read',
      'opportunities:chat:create',
      'fundraising:create',
      'jackpot:enter',
      'education:read',

      // Admin/Support capabilities
      'users:list',
      'coupons:update',

      // Additional support capabilities (everything except restricted ones)
      'education:create',
      'education:update',
      'education:delete',
      'advisory:create',
      'advisory:update',
      'advisory:delete',
      'opportunities:create',
      'opportunities:update',
      'opportunities:delete',
      'sponsors:update',
    ],
  },
};

// Check if a role has a specific capability
const hasCapability = (role, capability) => {
  if (!capabilities[role]) {
    return false;
  }

  // Admin can do anything
  if (capabilities[role].can.includes('*')) {
    return true;
  }

  return capabilities[role].can.includes(capability);
};

// Get capabilities for a role
const getCapabilities = (role) => {
  return capabilities[role] || { can: [] };
};

// Get all defined capabilities
const getAllCapabilities = () => {
  return capabilities;
};

module.exports = {
  capabilities,
  hasCapability,
  getCapabilities,
  getAllCapabilities,
};