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
import gasketData from './gasket-data.js';
import pluginCds from '@venture/gasket-plugin-cds';

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
    'local.dev': {
      http: false,
      https: {
        port: 8443
      },
      httpsProxy: {
        protocol: 'https',
        hostname: 'local.gasket.dev-godaddy.com',
        port: 8443,
        xfwd: true,
        ws: true,
        secure: false,
        target: {
          protocol: 'https:',
          host: 'localhost',
          port: 3000
        },
        ssl: {
          key: fs.readFileSync('./node_modules/@godaddy/gasket-plugin-dev-certs/certs/_.gasket.dev-godaddy.com.key'),
          cert: fs.readFileSync('./node_modules/@godaddy/gasket-plugin-dev-certs/certs/_.gasket.dev-godaddy.com.crt')
        },
      }
    },
    'local.test': {
      http: false,
      https: {
        port: 443
      },
      httpsProxy: {
        protocol: 'https',
        hostname: 'airo-builder.test-godaddy.com',
        port: 443,
        xfwd: true,
        ws: true,
        secure: false,
        target: {
          protocol: 'https:',
          host: 'localhost',
          port: 3000
        },
        ssl: (() => {
          const keyPath = './certificates/airo-builder.test-godaddy.com.key';
          const certPath = './certificates/airo-builder.test-godaddy.com.crt';

          if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
            return {
              key: fs.readFileSync(keyPath),
              cert: fs.readFileSync(certPath)
            };
          }

          console.warn('No SSL certificates found for local.test environment. Generate them using pluginSelfCerts.');
          return undefined;
        })()
      },
      devCerts: {
        path: 'certificates',
        commonNames: [
          'airo-builder.test-godaddy.com'
        ]
      },
    },
    'local.prod': {
      http: false,
      https: {
        port: 443
      },
      httpsProxy: {
        protocol: 'https',
        hostname: 'airo-builder.godaddy.com',
        port: 443,
        xfwd: true,
        ws: true,
        secure: false,
        target: {
          protocol: 'https:',
          host: 'localhost',
          port: 3000
        },
        ssl: (() => {
          const keyPath = './certificates/airo-builder.godaddy.com.key';
          const certPath = './certificates/airo-builder.godaddy.com.crt';

          if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
            return {
              key: fs.readFileSync(keyPath),
              cert: fs.readFileSync(certPath)
            };
          }

          console.warn('No SSL certificates found for local.prod environment. Generate them using pluginSelfCerts.');
          return undefined;
        })()
      },
      devCerts: {
        path: 'certificates',
        commonNames: [
          'airo-builder.godaddy.com'
        ]
      },
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
    pluginCds,
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
      'en-AE',
      'en-AU',
      'en-CA',
      'en-IE',
      'en-IL',
      'en-IN',
      'en-MY',
      'en-NZ',
      'en-PH',
      'en-PK',
      'en-SG',
      'en-UK',
      'en-ZA',
      'da-DK',
      'de-DE',
      'de-AT',
      'de-CH',
      'el-GR',
      'es-ES',
      'es-MX',
      'es-US',
      'es-AR',
      'es-CL',
      'es-CO',
      'es-PE',
      'es-VE',
      'fi-FI',
      'fr-CA',
      'fr-FR',
      'fr-BE',
      'fr-CH',
      'hi-IN',
      'id-ID',
      'it-IT',
      'it-CH',
      'ja-JP',
      'ko-KR',
      'nb-NO',
      'nl-NL',
      'nl-BE',
      'pl-PL',
      'pt-BR',
      'pt-PT',
      'sv-SE',
      'th-TH',
      'tr-TR',
      'uk-UA',
      'vi-VN',
      'zh-CN',
      'zh-TW',
      'zh-SG',
    ],
    defaultLocale: 'en-US',
    nextRouting: false
  },
  uxp: {
    externals: false
  },
  ...(isJWTMode ? {
    auth: {
      realm: 'idp',
      risk: 'high',
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
      app: 'airo-builder',
      manifest: 'no-header',
      theme: 'godaddy:site',
      privateLabel: 1,
    }
  },
  cds: {
    api: {
      baseUrl: process.env.CDS_API_BASE_URL || 'https://cds.api.int.dev-godaddy.com',
      logPath: '/log'
    },
    componentTypes: [
      'godaddyUnifiedPlansAndPricingLibrary'
    ],
    appName: 'airo-app-builder',
    enabledRoutes: ['/', '/page', '/develop', '/develop/*'],
    proxyLogPath: '/cds-log',
    depsPath: 'cds'
  },
  data: gasketData,
} as GasketConfigDefinition);
