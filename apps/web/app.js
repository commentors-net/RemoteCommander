// Phusion Passenger / cPanel Application Manager Entry Point
// CommonJS entry point for Passenger load_node_app loader
try {
  process.chdir(__dirname);
  require('./dist/server/index.cjs');
} catch (err) {
  console.error('[RemoteCommander Web] Failed to launch server:', err);
  process.exit(1);
}
