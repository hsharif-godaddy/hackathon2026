import fs from 'node:fs';

import type { GasketConfigDefinition } from '@gasket/core';
import { makeGasket } from '@gasket/core';
import pluginCommand from '@gasket/plugin-command';
import pluginData from '@gasket/plugin-data';
import pluginDynamicPlugins from '@gasket/plugin-dynamic-plugins';
import pluginHttpsProxy from '@gasket/plugin-https-proxy';
import pluginIntl from '@gasket/plugin-intl';
import pluginLogger from '@gasket/plugin-logger';
import pluginNextjs from '@gasket/plugin-nextjs';
import pluginWebpack from '@gasket/plugin-webpack';
import pluginWinston from '@gasket/plugin-winston';
import pluginAtlas from '@godaddy/gasket-plugin-atlas';
import pluginAuth from '@godaddy/gasket-plugin-auth';
import pluginDevCerts from '@godaddy/gasket-plugin-dev-certs';
import pluginOtel from '@godaddy/gasket-plugin-otel';
import pluginSecurity from '@godaddy/gasket-plugin-security';
import pluginSelfCerts from '@godaddy/gasket-plugin-self-certs';
import pluginSwitchboard from '@godaddy/gasket-plugin-switchboard';
import pluginTraffic from '@godaddy/gasket-plugin-traffic';
import pluginUxp from '@godaddy/gasket-plugin-uxp';
import pluginVisitor from '@godaddy/gasket-plugin-visitor';
import pluginCds from '@venture/gasket-plugin-cds';

import gasketData from './gasket-data.js';

// Check if we should enable JWT authentication
const authType = process.env.AUTH_TYPE?.toLowerCase() || 'jwt';
const isJWTMode = authType === 'jwt' || (process.env.NODE_ENV === 'production' && !authType);
export default makeGasket({
  environments: {
    'local.analyze': {
      dynamicPlugins: [
        '@gasket/plugin-analyze'
      ],
      switchboard: {
        env: 'development'
      }
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
      },
      switchboard: {
        env: 'development'
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
      switchboard: {
        env: 'test'
      }
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
      switchboard: {
        env: 'production'
      }
    },
    // Deployed environments
    'development': {
      switchboard: {
        env: 'development'
      }
    },
    'test': {
      switchboard: {
        env: 'test'
      }
    },
    'production': {
      switchboard: {
        env: 'production'
      }
    },
  },
  plugins: [
    pluginCommand,
    pluginDynamicPlugins,
    pluginLogger,
    pluginData,
    pluginWebpack,
    pluginWinston,
    pluginSecurity,
    pluginTraffic,
    pluginVisitor, // Must come before auth plugin to populate visitor.hostname
    // Only include auth plugin when using JWT authentication
    ...(isJWTMode ? [pluginAuth] : []),
    pluginDevCerts,
    pluginSelfCerts,
    pluginAtlas,
    pluginHttpsProxy,
    pluginNextjs,
    pluginIntl,
    pluginUxp,
    pluginOtel,
    pluginCds,
    pluginSwitchboard
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
      host: process.env.SSO_HOST ? [process.env.SSO_HOST] : ['godaddy.com'],
      ssoRedirectOverride: process.env.SSO_LOGIN_URL,
      ssoLogoutOverride: process.env.SSO_LOGOUT_URL,
      ssoRedirectSubdomain: false,
      appName: 'airo-builder', // Fallback when visitor.hostname is unavailable
      // Let Gasket handle automatic redirects to SSO
      alt: undefined // This allows automatic SSO redirects instead of showing alt content
    }
  } : {}),
  presentationCentral: {
    params: {
      app: 'airo-builder',
      manifest: 'no-header',
      theme: 'godaddy-antares',
      privateLabel: 1,
    }
  },
  cds: {
    api: {
      baseUrl: process.env.CDS_API_BASE_URL || 'https://cds.api.int.godaddy.com',
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
  switchboard: {
    // Fetch only Hivemind experiments (no regular Switchboard feature flags due to caching issues)
    app: '@hivemind',
    // Default to production - overridden by environment-specific config in `environments`
    env: 'production',
    appLabels: {
      '@hivemind': ['airo-builder']
    },
    auth: {
      primaryRegion: 'us-west-2',
      secondaryRegion: 'us-east-1'
    },
    enableGasketData: true
  },
  data: gasketData,
} as GasketConfigDefinition);
