// This separate gasket file is necessary to access the visitor details in
// Next.js Middleware which does not currently support any Node runtime.
// @see: https://nextjs.org/docs/pages/building-your-application/routing/middleware#runtime

import { makeGasket } from '@gasket/core';
import pluginVisitor from '@godaddy/gasket-plugin-visitor';

export default makeGasket({
  plugins: [
    pluginVisitor
  ],
  root: '.'
});
