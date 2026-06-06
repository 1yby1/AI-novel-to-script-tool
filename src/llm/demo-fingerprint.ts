/**
 * Fingerprint of the built-in demo novel — `computeSourceFingerprint` of its parsed
 * paragraphs. Single source of truth shared by the server-side fixture provider and the
 * client workbench (this module is pure, with no server-only imports, so the client can
 * import it safely). Verified against the parser by tests/integration/fixture-pipeline.test.ts.
 */
export const DEMO_SOURCE_FINGERPRINT = "68d7c2e2e2ec7e59";
