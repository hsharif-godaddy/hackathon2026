### Runtime
- The app must listen on `process.env.PORT`. Hard-coded ports will fail in the PaaS environment.
- The app must bind to `0.0.0.0` (or all interfaces), not `localhost`.
- Required environment variables must be configured via PaaS secrets or a `.env` file included at deploy time.
