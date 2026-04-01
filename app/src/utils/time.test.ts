import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { timeAgo } from './time';

const FIXED_NOW = new Date('2024-06-15T12:00:00.000Z');

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return builder_time_now when less than one minute ago', function nowBucket() {
    const past = new Date('2024-06-15T11:59:30.000Z');
    expect(timeAgo(past)).toEqual({ key: 'builder_time_now', values: {} });
  });

  it('should return builder_time_minutes_ago for Date input in the minutes range', function minutesDate() {
    const past = new Date('2024-06-15T11:30:00.000Z');
    expect(timeAgo(past)).toEqual({ key: 'builder_time_minutes_ago', values: { minutes: 30 } });
  });

  it('should return builder_time_minutes_ago for ISO string input', function minutesString() {
    expect(timeAgo('2024-06-15T11:30:00.000Z')).toEqual({
      key: 'builder_time_minutes_ago',
      values: { minutes: 30 },
    });
  });

  it('should use minutes bucket at exactly one minute', function oneMinute() {
    const past = new Date('2024-06-15T11:59:00.000Z');
    expect(timeAgo(past)).toEqual({ key: 'builder_time_minutes_ago', values: { minutes: 1 } });
  });

  it('should return builder_time_hours_ago when one hour or more and under one day', function hoursBucket() {
    const past = new Date('2024-06-15T10:00:00.000Z');
    expect(timeAgo(past)).toEqual({ key: 'builder_time_hours_ago', values: { hours: 2 } });
  });

  it('should return builder_time_days_ago when one day or more and under one month', function daysBucket() {
    const past = new Date('2024-06-14T12:00:00.000Z');
    expect(timeAgo(past)).toEqual({ key: 'builder_time_days_ago', values: { days: 1 } });
  });

  it('should return builder_time_months_ago when 30 days or more and under one year', function monthsBucket() {
    const past = new Date('2024-05-16T12:00:00.000Z');
    expect(timeAgo(past)).toEqual({ key: 'builder_time_months_ago', values: { months: 1 } });
  });

  it('should return builder_time_years_ago when 365 days or more', function yearsBucket() {
    const past = new Date('2023-06-15T12:00:00.000Z');
    expect(timeAgo(past)).toEqual({ key: 'builder_time_years_ago', values: { years: 1 } });
  });

  it('should treat future dates as builder_time_now', function futureDate() {
    const future = new Date('2024-06-15T12:30:00.000Z');
    expect(timeAgo(future)).toEqual({ key: 'builder_time_now', values: {} });
  });
});
