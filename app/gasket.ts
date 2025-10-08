import type { GasketConfigDefinition } from '@gasket/core';
import { makeGasket } from '@gasket/core';
import pluginCommand from '@gasket/plugin-command';
import pluginDynamicPlugins from '@gasket/plugin-dynamic-plugins';
import pluginLogger from '@gasket/plugin-logger';
import pluginData from '@gasket/plugin-data';
import pluginWebpack from '@gasket/plugin-webpack';
import pluginWinston from '@gasket/plugin-winston';
import pluginAuth from '@godaddy/gasket-plugin-auth';
import pluginSecurity from '@godaddy/gasket-plugin-security';
import pluginTraffic from '@godaddy/gasket-plugin-traffic';
import pluginVisitor from '@godaddy/gasket-plugin-visitor';
import pluginDevCerts from '@godaddy/gasket-plugin-dev-certs';
import pluginSelfCerts from '@godaddy/gasket-plugin-self-certs';
import pluginAtlas from '@godaddy/gasket-plugin-atlas';
import pluginHttpsProxy from '@gasket/plugin-https-proxy';
import pluginNextjs from '@gasket/plugin-nextjs';
import pluginIntl from '@gasket/plugin-intl';
import pluginUxp from '@godaddy/gasket-plugin-uxp';
import pluginOtel from '@godaddy/gasket-plugin-otel';
import pluginSwitchboard from '@godaddy/gasket-plugin-switchboard';
import gasketData from './gasket-data.js';
import fs from 'fs';

// Check if we should enable JWT authentication
const authType = process.env.AUTH_TYPE?.toLowerCase() || 'jwt';
const isJWTMode = authType === 'jwt' || (process.env.NODE_ENV === 'production' && !authType);
export default makeGasket({
  environments: {
    'local.analyze': {
      dynamicPlugins: [
        '@gasket/plugin-analyze'
      ]
    },
  },
  plugins: [
    pluginCommand,
    pluginDynamicPlugins,
    pluginLogger,
    pluginData,
    pluginWebpack,
    pluginWinston,
    // Only include auth plugin when using JWT authentication
    ...(isJWTMode ? [pluginAuth] : []),
    pluginSecurity,
    pluginTraffic,
    pluginVisitor,
    pluginDevCerts,
    pluginSelfCerts,
    pluginAtlas,
    pluginHttpsProxy,
    pluginNextjs,
    pluginIntl,
    pluginUxp,
    pluginOtel,
    ...(isJWTMode ? [pluginSwitchboard] : []),
  ],
  commands: {
    docs: {
      dynamicPlugins: [
        '@gasket/plugin-docs',
        '@gasket/plugin-metadata',
        '@gasket/plugin-docusaurus'
      ]
    }
  },
  httpsProxy: {
    protocol: 'https',
    hostname: 'local.gasket.dev-godaddy.com',
    port: 8443,
    xfwd: true,
    ws: true,
    target: {
      host: 'localhost',
      port: 3000
    },
    ...(process.env.NODE_ENV === 'production' && (() => {
      const keyPath = process.env.SERVER_KEY_PATH || '/workspace/app/certs/server.key';
      const certPath = process.env.SERVER_CERT_PATH || '/workspace/app/certs/server.crt';
      if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        return {
          ssl: {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
          }
        };
      } else {
        console.warn(`SSL certificate files not found at ${keyPath} and/or ${certPath}, skipping SSL configuration`);
        return {};
      }
    })())
  },
  intl: {
    locales: [
      'en-US',
      'fr-FR'
    ],
    defaultLocale: 'en-US',
    managerFilename: 'intl.ts',
    nextRouting: false
  },
  uxp: {
    useMintl: true,
    externals: false
  },
  ...(isJWTMode ? {
    auth: {
      realm: 'idp',
      risk: 'low',
      type: ['basic'],
      allowHeartbeat: true,
      use12HourExpiration: true,
      ssoRedirectOverride: process.env.SSO_LOGIN_URL,
      ssoLogoutOverride: process.env.SSO_LOGOUT_URL,
      ssoRedirectSubdomain: false,
      // Let Gasket handle automatic redirects to SSO
      alt: undefined // This allows automatic SSO redirects instead of showing alt content
    }
  } : {}),
  presentationCentral: {
    params: {
      app: 'airo-app-builder',
      manifest: 'no-header',
      theme: 'godaddy:site',
      privateLabelId: 1,
    }
  },
  ...(isJWTMode ? {
    switchboard: {
      app: 'airo-app-builder',
      enableGasketData: true
    }
  } : {}),
  data: gasketData,
} as GasketConfigDefinition);
