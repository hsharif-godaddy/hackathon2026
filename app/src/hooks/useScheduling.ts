import { useEffect, useState } from 'react'

import { PublishTiming } from '@/types/social-posts'
import { getUserLocale } from '@/utils/common'
import { getInitialScheduleDate, getInitialScheduleTime, isValidScheduleTime } from '@/utils/social/scheduling'

interface UseSchedulingReturn {
    timing: PublishTiming
    date: string[]
    time: string
    isValid: boolean
    setTiming: (timing: PublishTiming) => void
    setDate: (date: string[]) => void
    setTime: (time: string) => void
}

/**
 * Custom hook for managing social post scheduling state and validation
 * Handles date/time selection and validates scheduling requirements
 */
export function useScheduling(): UseSchedulingReturn {
    const [timing, setTiming] = useState<PublishTiming>(PublishTiming.NOW)
    const [date, setDate] = useState<string[]>(() => [getInitialScheduleDate()])
    const [time, setTime] = useState<string>(() => getInitialScheduleTime(getUserLocale()))
    const [validationTick, setValidationTick] = useState(0)

    // Periodically revalidate scheduled time to ensure it stays valid
    useEffect(() => {
        if (timing === PublishTiming.LATER) {
            const interval = setInterval(() => {
                setValidationTick((prev) => prev + 1)
            }, 30000) // Revalidate every 30 seconds
            return () => clearInterval(interval)
        }
    }, [timing])

    // Force validation check by using validationTick as part of the computation
    const isValid =
        timing === PublishTiming.NOW ||
        (date.length > 0 && time && isValidScheduleTime(date[0], time) && validationTick >= 0)

    return {
        timing,
        date,
        time,
        isValid,
        setTiming,
        setDate,
        setTime,
    }
}
