// Tiny structured-log helper shared across fanout modules. Lambda
// CloudWatch consumes line-delimited JSON; keeping a single shape here
// (level + msg + arbitrary fields) means dashboards / log queries don't
// have to special-case any single module.
//
// `level` is "info" / "warn" / "error" — strings rather than enum values
// to match the legacy callsites in handler.mjs that all spell them out.
// Anything that is not "error" goes through console.log so CloudWatch
// keeps regular-priority log delivery rather than promoting transient
// warns to error-stream noise.
export const log = (level, domain, fields) => {
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({
    level,
    msg: domain,
    ...fields,
  }));
};
