import { useEffect, useState } from 'react'

import { useUserLocale } from '@/hooks/useUserLocale'
import { PublishTiming } from '@/types/social-posts'
import { createLocalDateTime, getInitialScheduleDate, getInitialScheduleTime, isValidScheduleTime } from '@/utils/social/scheduling'

interface UseSchedulingReturn {
    timing: PublishTiming
    date: string[]
    time: string
    isValid: boolean
    setTiming: (timing: PublishTiming) => void
    setDate: (date: string[]) => void
    setTime: (time: string) => void
}

interface UseSchedulingOptions {
    initialTiming?: PublishTiming
    initialDate?: string
    initialTime?: string
}

/**
 * Custom hook for managing social post scheduling state and validation
 * Handles date/time selection and validates scheduling requirements
 */
export function useScheduling(options?: UseSchedulingOptions): UseSchedulingReturn {
    const locale = useUserLocale()
    const [timing, setTiming] = useState<PublishTiming>(options?.initialTiming || PublishTiming.NOW)
    const [date, setDate] = useState<string[]>(() =>
        options?.initialDate ? [options.initialDate] : [getInitialScheduleDate()]
    )
    const [time, setTime] = useState<string>(() =>
        options?.initialTime || getInitialScheduleTime(locale)
    )
    const [validationTick, setValidationTick] = useState(0)

    // Revalidate scheduled time when it approaches the 15-minute minimum threshold
    useEffect(() => {
        if (timing === PublishTiming.LATER && date[0] && time) {
            // Calculate when scheduled time gets too close (within 15 min + 1 min buffer)
            const scheduledDateTime = createLocalDateTime(date[0], time)
            const minimumFutureTime = 15 * 60 * 1000 // 15 minutes in ms
            const buffer = 60 * 1000 // 1 minute buffer to catch it slightly early
            const timeUntilInvalid = scheduledDateTime.getTime() - Date.now() - minimumFutureTime - buffer

            if (timeUntilInvalid > 0) {
                // Set timeout to trigger validation when time becomes too close
                const timeout = setTimeout(() => {
                    setValidationTick((prev) => prev + 1)
                }, timeUntilInvalid)

                return () => clearTimeout(timeout)
            } else {
                // Already invalid, trigger validation immediately
                setValidationTick((prev) => prev + 1)
            }
        }
    }, [timing, date, time])

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
