// Base URLs for upstream GoDaddy services proxied by this app.
// Defaults point at the prod hosts so existing deployments keep working
// without configuration; override via env when pointing at a non-prod
// environment (e.g. an ephemeral test stack).

export const SHOPPER_BASE_URL =
    process.env.SHOPPER_BASE_URL || 'https://shopper.api.int.godaddy.com';

export const CARE_BASE_URL =
    process.env.CARE_BASE_URL || 'https://conversation-state-service.care.godaddy.com';
