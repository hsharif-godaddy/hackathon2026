import { useCallback, useEffect, useRef } from 'react'

interface UseSoundOptions {
  volume?: number
  interrupt?: boolean
}

interface UseSoundReturn {
  play: () => void
  stop: () => void
  pause: () => void
}

/**
 * Custom hook for playing sounds with reliable playback
 * Uses native HTML5 Audio API to avoid cutoff issues
 */
export function useSound(
  src: string,
  options: UseSoundOptions = {}
): [() => void, UseSoundReturn] {
  const { volume = 1.0, interrupt = true } = options
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const currentPlayingRef = useRef<HTMLAudioElement | null>(null)

  // Initialize audio once
  useEffect(() => {
    audioRef.current = new Audio(src)
    audioRef.current.volume = volume
    audioRef.current.preload = 'auto'

    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current = null
      }
      if (currentPlayingRef.current) {
        currentPlayingRef.current.pause()
        currentPlayingRef.current.src = ''
        currentPlayingRef.current = null
      }
    }
  }, [src, volume])

  const play = useCallback(() => {
    if (!audioRef.current) return

    // If interrupt is false and audio is already playing, don't interrupt it
    if (!interrupt && currentPlayingRef.current && !currentPlayingRef.current.paused) {
      return
    }

    // Stop any currently playing instance if interrupt is true
    if (interrupt && currentPlayingRef.current) {
      currentPlayingRef.current.pause()
      currentPlayingRef.current.currentTime = 0
    }

    // Create a new Audio instance to allow overlapping sounds with consistent initialization
    const audio = new Audio(src)
    audio.volume = volume
    audio.preload = 'auto'
    currentPlayingRef.current = audio

    // Clean up reference when done playing
    const onEnded = () => {
      if (currentPlayingRef.current === audio) {
        currentPlayingRef.current = null
      }
      audio.removeEventListener('ended', onEnded)
    }
    audio.addEventListener('ended', onEnded)

    audio.play().catch(err => {
      console.warn('Failed to play sound:', err)
    })
  }, [volume, interrupt])

  const stop = useCallback(() => {
    if (currentPlayingRef.current) {
      currentPlayingRef.current.pause()
      currentPlayingRef.current.currentTime = 0
      currentPlayingRef.current = null
    }
  }, [])

  const pause = useCallback(() => {
    if (currentPlayingRef.current) {
      currentPlayingRef.current.pause()
    }
  }, [])

  return [play, { play, stop, pause }]
}
