// cds-loader data-URL generation only re-exports keys found on the namespace object;
// direct `import * as events from 'events'` yields only `default` (CJS compat).
import EventEmitter from 'events'

export { EventEmitter }
export default EventEmitter
