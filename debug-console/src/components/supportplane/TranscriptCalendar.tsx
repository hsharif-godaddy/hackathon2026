'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import sp from './sp.module.css';

interface CalendarDay {
  date: string;
  count: number;
}

interface CalendarData {
  year: number;
  month: number;
  days: CalendarDay[];
  dateRange: {
    min_date: string | null;
    max_date: string | null;
    total: number;
  };
}

interface TranscriptCalendarProps {
  onDateClick?: (date: string) => void;
}

export default function TranscriptCalendar({ onDateClick }: TranscriptCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  useEffect(() => {
    async function fetchCalendar() {
      setLoading(true);
      try {
        const res = await fetch(`/api/supportplane/transcripts/calendar?year=${year}&month=${month}`);
        if (res.ok) {
          const data = await res.json();
          setCalendarData(data);
        }
      } catch (err) {
        console.error('Failed to fetch calendar:', err);
      } finally {
        setLoading(false);
      }
    }
    void fetchCalendar();
  }, [year, month]);

  const goToPrevMonth = () => {
    setCurrentDate(new Date(year, month - 2, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  if (loading) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--t3)', fontSize: 12 }}>
        Loading calendar...
      </div>
    );
  }

  if (!calendarData) {
    return null;
  }

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

  // Create day lookup map
  const dayMap = new Map<string, number>();
  calendarData.days.forEach(day => {
    dayMap.set(day.date, day.count);
  });

  // Get max count for color scaling
  const maxCount = Math.max(...calendarData.days.map(d => d.count), 1);

  // Find the last date with data (for missing data detection)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let lastDataDate: Date | null = null;
  if (calendarData.dateRange.max_date) {
    lastDataDate = new Date(calendarData.dateRange.max_date);
    lastDataDate.setHours(0, 0, 0, 0);
  }

  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = new Array(7).fill(null);

  // Fill first week with leading nulls
  for (let i = 0; i < startDayOfWeek; i++) {
    week[i] = null;
  }

  // Fill in days
  for (let day = 1; day <= daysInMonth; day++) {
    const dayIndex = (startDayOfWeek + day - 1) % 7;
    week[dayIndex] = day;

    if (dayIndex === 6 || day === daysInMonth) {
      weeks.push([...week]);
      week = new Array(7).fill(null);
    }
  }

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className={sp.card} style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)' }}>
          Data Coverage Calendar
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={goToPrevMonth}
            className={`${sp.btn} ${sp.btnSecondary}`}
            style={{ padding: '2px 6px', fontSize: 10 }}
          >
            <ChevronLeft size={12} />
          </button>
          <div style={{ fontSize: 11, fontWeight: 600, minWidth: 100, textAlign: 'center' }}>
            {monthNames[month - 1]} {year}
          </div>
          <button
            onClick={goToNextMonth}
            className={`${sp.btn} ${sp.btnSecondary}`}
            style={{ padding: '2px 6px', fontSize: 10 }}
          >
            <ChevronRight size={12} />
          </button>
          <button
            onClick={goToToday}
            className={`${sp.btn} ${sp.btnSecondary}`}
            style={{ padding: '2px 6px', fontSize: 10 }}
          >
            Today
          </button>
        </div>
      </div>

      {calendarData.dateRange.total > 0 && (
        <div style={{ fontSize: 9, color: 'var(--t3)', marginBottom: 8 }}>
          {calendarData.dateRange.min_date} → {calendarData.dateRange.max_date} ({calendarData.dateRange.total.toLocaleString()} records)
        </div>
      )}

      {/* Calendar Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {/* Day headers */}
        {dayNames.map(name => (
          <div key={name} style={{ fontSize: 8, fontWeight: 600, color: 'var(--t3)', textAlign: 'center', padding: 2 }}>
            {name}
          </div>
        ))}

        {/* Calendar days */}
        {weeks.map((week, weekIdx) => (
          week.map((day, dayIdx) => {
            if (day === null) {
              return <div key={`${weekIdx}-${dayIdx}`} style={{ aspectRatio: '1', background: 'transparent' }} />;
            }

            const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
            const count = dayMap.get(dateStr) || 0;
            const hasData = count > 0;
            const intensity = hasData ? Math.min(1, count / maxCount) : 0;

            const currentDate = new Date(year, month - 1, day);
            currentDate.setHours(0, 0, 0, 0);

            const isToday = year === today.getFullYear() &&
                           month === today.getMonth() + 1 &&
                           day === today.getDate();

            // Check if this date is missing data (between last data date and today)
            const isMissingData = !hasData &&
                                 lastDataDate &&
                                 currentDate > lastDataDate &&
                                 currentDate <= today;

            return (
              <div
                key={`${weekIdx}-${dayIdx}`}
                onClick={() => {
                  if (hasData && onDateClick) {
                    onDateClick(dateStr);
                  }
                }}
                style={{
                  aspectRatio: '1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  fontWeight: isToday ? 700 : 500,
                  background: isMissingData
                    ? 'rgba(239, 68, 68, 0.15)' // Red for missing data
                    : hasData
                    ? `rgba(8, 145, 178, ${0.3 + intensity * 0.7})`
                    : 'var(--surface2)',
                  color: isMissingData
                    ? '#ef4444'
                    : hasData && intensity > 0.3
                    ? '#fff'
                    : 'var(--t1)',
                  borderRadius: 2,
                  cursor: hasData ? 'pointer' : 'default',
                  border: isToday ? '1.5px solid var(--blue)' : isMissingData ? '1px solid #ef4444' : '1px solid var(--border)',
                  transition: 'all 0.15s',
                }}
                title={isMissingData
                  ? `${dateStr}: Missing data`
                  : hasData
                  ? `${dateStr}: ${count} transcripts`
                  : dateStr}
                onMouseEnter={(e) => {
                  if (hasData || isMissingData) {
                    e.currentTarget.style.transform = 'scale(1.1)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                {day}
              </div>
            );
          })
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, fontSize: 9, color: 'var(--t3)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Less</span>
          <div style={{ display: 'flex', gap: 1 }}>
            {[0, 0.25, 0.5, 0.75, 1].map((intensity, idx) => (
              <div
                key={idx}
                style={{
                  width: 12,
                  height: 12,
                  background: `rgba(8, 145, 178, ${0.15 + intensity * 0.7})`,
                  borderRadius: 2,
                  border: '1px solid var(--border)',
                }}
              />
            ))}
          </div>
          <span>More</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div
            style={{
              width: 12,
              height: 12,
              background: 'rgba(239, 68, 68, 0.15)',
              borderRadius: 2,
              border: '1px solid #ef4444',
            }}
          />
          <span>Missing data</span>
        </div>
      </div>
    </div>
  );
}
