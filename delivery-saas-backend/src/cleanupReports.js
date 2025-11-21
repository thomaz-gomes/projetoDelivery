import fs from 'fs/promises';
import path from 'path';

/**
 * Start a periodic cleanup that deletes files in public/reports older than maxAgeMs.
 * options:
 *  - reportsDir (string) path to reports dir. Default: <project>/public/reports
 *  - maxAgeMs (number) files older than this will be removed. Default: 24h
 *  - intervalMs (number) how often to run the cleanup. Default: 60min
 *  - logger (object) optional logger with info/debug/error
 */
export function startReportsCleanup(options = {}) {
  const projectRoot = process.cwd();
  const reportsDir = options.reportsDir || path.join(projectRoot, 'public', 'reports');
  const maxAgeMs = typeof options.maxAgeMs === 'number' ? options.maxAgeMs : (parseInt(process.env.REPORTS_MAX_AGE_HOURS || '24', 10) * 3600 * 1000);
  const intervalMs = typeof options.intervalMs === 'number' ? options.intervalMs : (parseInt(process.env.REPORTS_CLEANUP_INTERVAL_MIN || '60', 10) * 60 * 1000);
  const logger = options.logger || console;

  let running = false;

  async function runOnce() {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      // ensure dir exists
      try {
        await fs.access(reportsDir);
      } catch (e) {
        // nothing to clean
        logger.debug && logger.debug(`Reports cleanup: directory not found ${reportsDir}`);
        running = false;
        return;
      }

      const entries = await fs.readdir(reportsDir);
      for (const name of entries) {
        const full = path.join(reportsDir, name);
        try {
          const stat = await fs.stat(full);
          if (!stat.isFile()) continue;
          const age = now - stat.mtimeMs;
          if (age > maxAgeMs) {
            await fs.unlink(full);
            logger.info && logger.info(`Reports cleanup: removed ${full} (age ${Math.round(age/1000)}s)`);
          }
        } catch (e) {
          logger.error && logger.error(`Reports cleanup: error handling ${full}:`, e?.message || e);
        }
      }
    } catch (e) {
      logger.error && logger.error('Reports cleanup failed:', e?.message || e);
    } finally {
      running = false;
    }
  }

  // run immediately, then schedule
  runOnce().catch(err => logger.error && logger.error('Reports cleanup initial run error:', err));
  const timer = setInterval(() => runOnce().catch(err => logger.error && logger.error('Reports cleanup error:', err)), intervalMs);

  // return a stop handle
  return {
    stop() {
      clearInterval(timer);
    }
  };
}

export default startReportsCleanup;
