import type { LighthouseResult, PlaywrightPage } from '../playwright-types.js';
import type { EvaluatorResult, MetricRating, MetricValue, PerformanceScore } from '../types.js';
import { METRIC_THRESHOLDS } from '../types.js';

/**
 * Extracts a metric value and determines its rating based on thresholds
 */
function extractMetric(
  value: number,
  goodThreshold: number,
  poorThreshold: number
): MetricValue {
  let rating: MetricRating = 'good';
  if (value > poorThreshold) {
    rating = 'poor';
  } else if (value > goodThreshold) {
    rating = 'needs-improvement';
  }
  return { value, rating };
}

/**
 * Evaluates performance using Lighthouse API
 * Requires Chrome to be running with remote debugging enabled
 */
export async function evaluate(
  url: string,
  chromePort?: number
): Promise<EvaluatorResult<PerformanceScore>> {
  const startTime = Date.now();

  try {
    // Dynamic import to avoid issues if lighthouse is not installed
    const lighthouse = await import('lighthouse');
    const runLighthouse = lighthouse.default as (url: string, options: unknown) => Promise<LighthouseResult>;

    if (!chromePort) {
      return {
        success: false,
        error: 'Chrome debugging port required for Lighthouse. Pass chromePort option.',
        duration: Date.now() - startTime,
      };
    }

    const result = await runLighthouse(url, {
      port: chromePort,
      onlyCategories: ['performance'],
      formFactor: 'desktop',
      screenEmulation: {
        mobile: false,
        width: 1350,
        height: 940,
        deviceScaleFactor: 1,
        disabled: false,
      },
      throttling: {
        rttMs: 40,
        throughputKbps: 10240,
        cpuSlowdownMultiplier: 1,
        requestLatencyMs: 0,
        downloadThroughputKbps: 0,
        uploadThroughputKbps: 0,
      },
      output: 'json',
    });

    if (!result?.lhr) {
      return {
        success: false,
        error: 'Lighthouse returned no results',
        duration: Date.now() - startTime,
      };
    }

    const { audits, categories } = result.lhr;
    const performanceScore = categories.performance?.score ?? 0;

    // Extract individual metrics
    const lcpValue = audits['largest-contentful-paint']?.numericValue ?? 0;
    const inpValue = audits['interaction-to-next-paint']?.numericValue ?? 0;
    const clsValue = audits['cumulative-layout-shift']?.numericValue ?? 0;
    const fcpValue = audits['first-contentful-paint']?.numericValue ?? 0;
    const tbtValue = audits['total-blocking-time']?.numericValue ?? 0;
    const siValue = audits['speed-index']?.numericValue ?? 0;

    const data: PerformanceScore = {
      score: Math.round(performanceScore * 100),
      lcp: extractMetric(lcpValue, METRIC_THRESHOLDS.lcp.good, METRIC_THRESHOLDS.lcp.poor),
      inp: extractMetric(inpValue, METRIC_THRESHOLDS.inp.good, METRIC_THRESHOLDS.inp.poor),
      cls: extractMetric(clsValue, METRIC_THRESHOLDS.cls.good, METRIC_THRESHOLDS.cls.poor),
      fcp: extractMetric(fcpValue, METRIC_THRESHOLDS.fcp.good, METRIC_THRESHOLDS.fcp.poor),
      tbt: extractMetric(tbtValue, METRIC_THRESHOLDS.tbt.good, METRIC_THRESHOLDS.tbt.poor),
      speedIndex: extractMetric(siValue, METRIC_THRESHOLDS.speedIndex.good, METRIC_THRESHOLDS.speedIndex.poor),
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during performance evaluation',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Alternative performance evaluation using Navigation Timing API
 * Works without Lighthouse, useful when Chrome debugging port is not available
 */
export async function evaluateWithNavigationTiming(
  page: PlaywrightPage
): Promise<EvaluatorResult<PerformanceScore>> {
  const startTime = Date.now();

  try {
    const metrics = await page.evaluate(() => {
      const timing = performance.timing;
      const navigationStart = timing.navigationStart;

      // Calculate metrics from Navigation Timing API
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
      const loadTime = timing.loadEventEnd - navigationStart;

      // Get LCP from PerformanceObserver if available
      let lcp = 0;
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      if (lcpEntries.length > 0) {
        lcp = lcpEntries[lcpEntries.length - 1].startTime;
      }

      // CLS from layout-shift entries
      interface LayoutShiftEntry extends PerformanceEntry {
        hadRecentInput: boolean;
        value: number;
      }

      let cls = 0;
      const layoutShiftEntries = performance.getEntriesByType('layout-shift') as LayoutShiftEntry[];
      for (const entry of layoutShiftEntries) {
        if (!entry.hadRecentInput) {
          cls += entry.value;
        }
      }

      return {
        fcp,
        lcp: lcp || loadTime * 0.7, // Estimate if not available
        cls,
        loadTime,
        domInteractive: timing.domInteractive - navigationStart,
        domContentLoaded: timing.domContentLoadedEventEnd - navigationStart,
      };
    });

    // Estimate TBT and Speed Index from available metrics
    const tbtEstimate = Math.max(0, metrics.domContentLoaded - metrics.fcp - 200);
    const speedIndexEstimate = (metrics.fcp + metrics.lcp) / 2;

    // Calculate overall score (simplified Lighthouse-like scoring)
    const lcpScore = metrics.lcp <= 2500 ? 100 : metrics.lcp <= 4000 ? 70 : 30;
    const fcpScore = metrics.fcp <= 1800 ? 100 : metrics.fcp <= 3000 ? 70 : 30;
    const clsScore = metrics.cls <= 0.1 ? 100 : metrics.cls <= 0.25 ? 70 : 30;
    const tbtScore = tbtEstimate <= 200 ? 100 : tbtEstimate <= 600 ? 70 : 30;

    const overallScore = Math.round((lcpScore * 0.25 + fcpScore * 0.1 + clsScore * 0.25 + tbtScore * 0.30) + 10);

    const data: PerformanceScore = {
      score: Math.min(100, overallScore),
      lcp: extractMetric(metrics.lcp, METRIC_THRESHOLDS.lcp.good, METRIC_THRESHOLDS.lcp.poor),
      inp: extractMetric(0, METRIC_THRESHOLDS.inp.good, METRIC_THRESHOLDS.inp.poor), // Can't measure without interaction
      cls: extractMetric(metrics.cls, METRIC_THRESHOLDS.cls.good, METRIC_THRESHOLDS.cls.poor),
      fcp: extractMetric(metrics.fcp, METRIC_THRESHOLDS.fcp.good, METRIC_THRESHOLDS.fcp.poor),
      tbt: extractMetric(tbtEstimate, METRIC_THRESHOLDS.tbt.good, METRIC_THRESHOLDS.tbt.poor),
      speedIndex: extractMetric(speedIndexEstimate, METRIC_THRESHOLDS.speedIndex.good, METRIC_THRESHOLDS.speedIndex.poor),
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during performance evaluation',
      duration: Date.now() - startTime,
    };
  }
}
