/**
 * Recharts 2.x class components are incompatible with React 19 JSX types.
 * Re-declare chart primitives as function components until recharts ships native support.
 */
import type { ComponentType } from 'react';

type RechartsComponent = ComponentType<Record<string, unknown>>;

declare module 'recharts' {
  export const Area: RechartsComponent;
  export const AreaChart: RechartsComponent;
  export const Bar: RechartsComponent;
  export const BarChart: RechartsComponent;
  export const CartesianGrid: RechartsComponent;
  export const Cell: RechartsComponent;
  export const ComposedChart: RechartsComponent;
  export const Legend: RechartsComponent;
  export const Line: RechartsComponent;
  export const LineChart: RechartsComponent;
  export const Pie: RechartsComponent;
  export const PieChart: RechartsComponent;
  export const PolarAngleAxis: RechartsComponent;
  export const PolarGrid: RechartsComponent;
  export const PolarRadiusAxis: RechartsComponent;
  export const Radar: RechartsComponent;
  export const RadarChart: RechartsComponent;
  export const ResponsiveContainer: RechartsComponent;
  export const Scatter: RechartsComponent;
  export const ScatterChart: RechartsComponent;
  export const Tooltip: RechartsComponent;
  export const XAxis: RechartsComponent;
  export const YAxis: RechartsComponent;
  export const ZAxis: RechartsComponent;
}
