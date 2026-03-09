export interface MetricDataPoint {
    name: string;
    time_dimension: string;
    avg_value: number;
}

export interface MetricsResponse {
    data: MetricDataPoint[];
}

export interface ChartDataPoint {
    time: string;
    [key: string]: string | number;
}
