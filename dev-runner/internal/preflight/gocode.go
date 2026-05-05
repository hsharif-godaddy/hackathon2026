package preflight

// S2SGoCodeEndpoint is the GoCode S2S endpoint dev-runner pins agents/.env to
// when GOCODE_USE_S2S_AUTH=true. s2s-auth.ts honors OPENAI_BASE_URL as an
// override; without an override NODE_ENV (development locally) would pick the
// dev GoCode endpoint. We pin to the test endpoint so local dev hits the same
// backend that already has a working IAM principal allowlist.
const S2SGoCodeEndpoint = "https://api.gocode.caas.test-gdcorp.tools"
