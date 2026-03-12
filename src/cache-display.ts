import chalk from 'chalk';
import { analyzeCacheRates, formatTokens, type CacheAnalysis } from './cache.js';

export interface CacheAnalysisOptions {
  days: number;
  json: boolean;
}

export async function runCacheAnalysis(opts: CacheAnalysisOptions): Promise<void> {
  const analysis = analyzeCacheRates(opts.days);
  
  if (opts.json) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }
  
  displayAnalysis(analysis);
}

function displayAnalysis(a: CacheAnalysis): void {
  console.log();
  console.log(chalk.bold('  pinch cache — prompt cache analysis') + chalk.dim(` (last ${a.period.days} ${a.period.days === 1 ? 'day' : 'days'})`));
  console.log();
  
  if (a.overall.totalRecords === 0) {
    console.log(chalk.yellow('  no cost records found for this period'));
    console.log();
    return;
  }
  
  // Overall metrics
  const hitRateColor = a.overall.hitRate >= 0.84 ? chalk.green : a.overall.hitRate >= 0.5 ? chalk.yellow : chalk.red;
  console.log('  ' + chalk.dim('overall hit rate:  ') + hitRateColor(formatPercent(a.overall.hitRate)) + chalk.dim(`  (best practice: ${formatPercent(a.bestPracticeRate)})`));
  console.log('  ' + chalk.dim('total input:       ') + formatTokens(a.overall.totalInput) + ' tokens');
  console.log('  ' + chalk.dim('cache reads:       ') + formatTokens(a.overall.totalCacheRead) + ' tokens');
  console.log('  ' + chalk.dim('cache writes:      ') + formatTokens(a.overall.totalCacheWrite) + ' tokens');
  
  if (a.wasteDollars > 0.01) {
    const wasteColor = a.wasteDollars > 10 ? chalk.red : a.wasteDollars > 1 ? chalk.yellow : chalk.white;
    console.log('  ' + chalk.dim('estimated waste:   ') + wasteColor(`$${a.wasteDollars.toFixed(2)}`) + chalk.dim(` vs best practice`));
  }
  
  // Top waste sessions
  if (a.topWasteSessions.length > 0 && a.topWasteSessions[0].wasteDollars > 0.01) {
    console.log();
    console.log(chalk.bold('  top sessions by waste:'));
    for (const sess of a.topWasteSessions.slice(0, 5)) {
      if (sess.wasteDollars < 0.01) continue;
      const hitRateStr = formatPercent(sess.hitRate);
      const hitColor = sess.hitRate === 0 ? chalk.red : sess.hitRate < 0.5 ? chalk.yellow : chalk.white;
      const skShort = sess.sk.length > 20 ? sess.sk.slice(0, 17) + '...' : sess.sk;
      console.log(
        '    ' +
        chalk.dim(skShort.padEnd(20)) +
        '  ' + hitColor(hitRateStr.padStart(4)) + ' hit' +
        '  ' + chalk.dim(formatTokens(sess.inputTokens + sess.cacheRead).padStart(6)) + ' input' +
        '  ' + chalk.yellow(`$${sess.wasteDollars.toFixed(2)} wasted`)
      );
    }
  }
  
  // Cache busters
  if (a.cacheBusters.length > 0) {
    console.log();
    console.log(chalk.bold('  cache busters detected:'));
    
    const noHits = a.cacheBusters.filter(b => b.type === 'no-hits');
    const ttlWaste = a.cacheBusters.filter(b => b.type === 'ttl-waste');
    const shortSession = a.cacheBusters.filter(b => b.type === 'short-session');
    
    if (noHits.length > 0) {
      console.log(chalk.yellow('    ⚠ ') + chalk.dim(`${noHits.length} ${noHits.length === 1 ? 'session' : 'sessions'} with zero cache hits`));
    }
    if (ttlWaste.length > 0) {
      console.log(chalk.yellow('    ⚠ ') + chalk.dim(`${ttlWaste.length} ${ttlWaste.length === 1 ? 'session' : 'sessions'} with high cache creation, low reads`));
    }
    if (shortSession.length > 0) {
      console.log(chalk.yellow('    ⚠ ') + chalk.dim(`${shortSession.length} ${shortSession.length === 1 ? 'session' : 'sessions'} too short for TTL`));
    }
  }
  
  console.log();
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
