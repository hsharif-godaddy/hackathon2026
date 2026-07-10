export interface PulseMockAnalytics {
  totalHostPageViews: number
  totalHostUniqueVisitors: number
  bounceRate: string
  avgSessionDuration: string
  clicksByElementData: Array<{ element: string; clicks: number }>
  topCTALabelsData: Array<{ label: string; clicks: number }>
  exitRateData: Array<{ page: string; exitRate: number }>
  sessionsByDeviceData: Array<{ device: string; sessions: number }>
}

function hashAppId(appId: string): number {
  let hash = 0
  for (let i = 0; i < appId.length; i++) {
    hash = ((hash << 5) - hash + appId.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export function getMockAnalytics(appId: string): PulseMockAnalytics {
  const seed = hashAppId(appId)
  return {
    totalHostPageViews: 28 + (seed % 20),
    totalHostUniqueVisitors: 24 + (seed % 15),
    bounceRate: '72%',
    avgSessionDuration: '0m 48s',
    clicksByElementData: [
      { element: 'Contact Button', clicks: 3 },
      { element: 'Hero Image', clicks: 12 },
      { element: 'Learn More', clicks: 8 },
    ],
    topCTALabelsData: [
      { label: 'Learn More', clicks: 8 },
      { label: 'Contact Us', clicks: 3 },
    ],
    exitRateData: [
      { page: '/contact', exitRate: 0.87 },
      { page: '/', exitRate: 0.74 },
    ],
    sessionsByDeviceData: [
      { device: 'Mobile', sessions: 21 },
      { device: 'Desktop', sessions: 7 },
    ],
  }
}
