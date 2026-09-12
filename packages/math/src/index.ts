// The math package is the single consumer-facing dependency: it re-exports
// the full @tessera/types surface alongside the economics and local adapter.
export * from '@tessera/types';
export * from './guards.js';
export * from './economics.js';
export * from './allocate.js';
export * from './local-port.js';
