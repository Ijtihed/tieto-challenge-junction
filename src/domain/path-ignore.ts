// Centralized path-ignore rules used by both the FS adapter (extractors,
// listDir) and the workspace.list_files action. Keeping these in one place
// guarantees that no extractor or rule evaluator ever sees a node_modules
// or build-output file, which is essential for clean architectural
// clustering -- otherwise "node_modules" and "dist" end up as the biggest
// clusters in a real repo.

/** Directory names that are always ignored during file discovery,
 *  regardless of .gitignore. */
export const ALWAYS_IGNORED_DIRS: ReadonlySet<string> = new Set([
  // VCS
  ".git", ".hg", ".svn",
  // Dependencies
  "node_modules", "vendor", ".venv", "venv", "__pycache__",
  ".pnpm-store", ".yarn", "bower_components",
  // Build / dist
  "dist", "build", "out", "target", ".next", ".nuxt", ".turbo",
  ".svelte-kit", ".astro", "tauri-build",
  // Cache / temp
  ".cache", ".parcel-cache", ".eslintcache",
  // Test artefacts
  "coverage", ".nyc_output", "test-results", "playwright-report",
  // OS / editor noise
  ".DS_Store", ".idea", ".vscode", ".fleet",
  // Generated / vendored
  "site/.next", "schema-cache",
]);

/** File names that are always ignored. Bare-name match (no path glob). */
export const ALWAYS_IGNORED_FILES: ReadonlySet<string> = new Set([
  ".DS_Store",
  "Thumbs.db",
  ".env",
  ".env.local",
  ".env.production",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "Gemfile.lock",
  "Podfile.lock",
  "poetry.lock",
  "uv.lock",
]);

/** True when any segment of the absolute or relative path matches a
 *  blocked directory name, or when the basename matches a blocked file
 *  name. Safe for both POSIX and Windows path separators. */
export function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return false;

  // Hidden files starting with a dot at the basename level (e.g. ".env.prod")
  // -- skip those explicitly.
  const basename = parts[parts.length - 1]!;
  if (ALWAYS_IGNORED_FILES.has(basename)) return true;

  for (const segment of parts) {
    if (ALWAYS_IGNORED_DIRS.has(segment)) return true;
  }
  return false;
}
