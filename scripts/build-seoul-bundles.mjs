// Compatibility alias; new cities use build:map-bundles -- <city>.
process.argv[2]='seoul';
await import('./build-map-bundles.mjs');
