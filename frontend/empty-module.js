// Intentionally empty shim.
//
// Used by `turbopack.resolveAlias` in next.config.ts to satisfy Node built-in
// imports (e.g. `fs` inside the Emscripten-based `wabt` package) that are
// statically required but never executed in the browser.
module.exports = {};
