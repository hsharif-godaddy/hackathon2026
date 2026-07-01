import type { ComponentType, RefAttributes } from 'react';
import EChartsReactCore from 'echarts-for-react/lib/core';
import type { EChartsReactProps } from 'echarts-for-react/lib/types';
import type { ECharts } from 'echarts';

export interface EChartsReactCoreRef {
  getEchartsInstance(): ECharts;
}

const ReactECharts = EChartsReactCore as unknown as ComponentType<
  EChartsReactProps & RefAttributes<EChartsReactCoreRef>
>;

export default ReactECharts;
