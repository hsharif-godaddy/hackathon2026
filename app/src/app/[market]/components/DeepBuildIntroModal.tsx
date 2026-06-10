'use client'

import Box from '@ux/box'
import Button from '@ux/button'
import Modal from '@ux/modal'
import text from '@ux/text'

interface DeepBuildIntroModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

function DragonIcon() {
  return (
    <svg
      viewBox="0 0 120 120"
      width="480"
      height="480"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="absolute -bottom-16 right-0 opacity-15 pointer-events-none"
    >
      <style>
        {`
          @keyframes dragon-float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-4px); }
          }
          @keyframes fire-flicker {
            0%, 100% { opacity: 0.9; transform: scaleX(1); }
            25% { opacity: 0.7; transform: scaleX(0.92); }
            50% { opacity: 0.95; transform: scaleX(1.05); }
            75% { opacity: 0.75; transform: scaleX(0.96); }
          }
          @keyframes wing-flap {
            0%, 100% { transform: rotate(0deg); }
            50% { transform: rotate(-3deg); }
          }
          .dragon-body { animation: dragon-float 3s ease-in-out infinite; }
          .dragon-fire { animation: fire-flicker 1.5s ease-in-out infinite; transform-origin: 42px 58px; }
          .dragon-wing { animation: wing-flap 2.5s ease-in-out infinite; transform-origin: 78px 44px; }
        `}
      </style>

      <g className="dragon-body">
        {/* Fire breath - emanating left from snout */}
        <g className="dragon-fire" style={{ transform: 'scaleX(-1)', transformOrigin: '42px 58px' }}>
          <path
            d="M8 58c4-6 10-10 18-12 6-2 12-1 16 2 -4 3-6 7-6 12 0 4 2 8 5 10 -6 1-12 0-17-3-6-3-12-6-16-9z"
            fill="url(#fire-gradient)"
          />
          <path
            d="M14 56c3-4 8-7 14-8 4-1 8 0 11 2 -3 2-4 5-4 8 0 3 1 5 3 7-4 1-8 0-12-2-4-2-9-4-12-7z"
            fill="url(#fire-inner)"
            opacity="0.8"
          />
        </g>

        {/* Dragon body */}
        <ellipse cx="72" cy="62" rx="22" ry="18" fill="url(#body-gradient)" />

        {/* Neck */}
        <path
          d="M58 50c-4-8-2-16 4-22 3-3 7-5 11-5 2 0 4 1 5 3-2 4-2 8 0 12 1 3 3 5 5 7"
          fill="url(#body-gradient)"
          stroke="url(#body-gradient)"
          strokeWidth="6"
          strokeLinecap="round"
        />

        {/* Head */}
        <ellipse cx="52" cy="28" rx="12" ry="10" fill="url(#head-gradient)" />

        {/* Snout */}
        <ellipse cx="42" cy="32" rx="7" ry="5" fill="url(#head-gradient)" />

        {/* Eye */}
        <circle cx="54" cy="26" r="3" fill="#1a1a2e" />
        <circle cx="55" cy="25" r="1" fill="#fff" />

        {/* Horn */}
        <path d="M56 18l4-10 2 9z" fill="#5e4a8a" />
        <path d="M50 20l-1-8 3 7z" fill="#5e4a8a" />

        {/* Wing */}
        <g className="dragon-wing">
          <path
            d="M78 44c8-14 20-20 32-18-4 6-6 14-4 22-8-2-16 0-22 4l-6-8z"
            fill="url(#wing-gradient)"
            opacity="0.85"
          />
          <path
            d="M84 42c5-8 12-12 20-11"
            stroke="#5e4a8a"
            strokeWidth="1.5"
            fill="none"
            opacity="0.6"
          />
          <path
            d="M82 48c6-6 14-9 22-7"
            stroke="#5e4a8a"
            strokeWidth="1.5"
            fill="none"
            opacity="0.6"
          />
        </g>

        {/* Tail */}
        <path
          d="M94 62c8 2 14 6 16 12 2 5 0 10-4 12-3-4-7-6-12-6-4 0-8 2-10 5"
          stroke="url(#body-gradient)"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Tail spade */}
        <path d="M106 86l6-4 2 6-6 2z" fill="#5e4a8a" />

        {/* Legs */}
        <path d="M62 76l-2 10h6l-1-10z" fill="url(#body-gradient)" />
        <path d="M80 76l-2 10h6l-1-10z" fill="url(#body-gradient)" />

        {/* Belly detail */}
        <ellipse cx="72" cy="68" rx="10" ry="6" fill="#7c5fbf" opacity="0.3" />
      </g>

      <defs>
        <linearGradient id="fire-gradient" x1="8" y1="58" x2="42" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff4500" />
          <stop offset="0.5" stopColor="#ff8c00" />
          <stop offset="1" stopColor="#ffd700" />
        </linearGradient>
        <linearGradient id="fire-inner" x1="14" y1="56" x2="38" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffdd00" />
          <stop offset="1" stopColor="#fff4b0" />
        </linearGradient>
        <linearGradient id="body-gradient" x1="50" y1="40" x2="95" y2="80" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6b4fa0" />
          <stop offset="1" stopColor="#3d2b6b" />
        </linearGradient>
        <linearGradient id="head-gradient" x1="40" y1="20" x2="60" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7c5fbf" />
          <stop offset="1" stopColor="#5a3d8a" />
        </linearGradient>
        <linearGradient id="wing-gradient" x1="78" y1="36" x2="110" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b6fc0" />
          <stop offset="1" stopColor="#4a3080" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default function DeepBuildIntroModal({ open, onClose, onConfirm }: DeepBuildIntroModalProps) {
  if (!open) return null

  return (
    <Modal
      title="Welcome to Deep Build"
      onClose={onClose}
      id="deep-build-intro-modal"
    >
      <Box orientation="vertical" gap="md" className="relative overflow-hidden">
        <DragonIcon />

        <text.p size={0} emphasis="passive">
          Deep Build is a research project exploring how AI can build higher-quality websites through deliberate process design.
        </text.p>

        <Box orientation="vertical" gap="sm">
          <text.p size={-1} className="font-semibold">Research Questions</text.p>
          <ol className="list-decimal pl-4 space-y-1">
            <li><text.span size={-1}>Can gathering more information up front produce better sites?</text.span></li>
            <li><text.span size={-1}>Does heavy planning before building improve quality?</text.span></li>
            <li><text.span size={-1}>Can sub-agents with managed context increase consistency?</text.span></li>
            <li><text.span size={-1}>Can higher-quality models (Opus) be used for planning without breaking the bank?</text.span></li>
            <li><text.span size={-1}>What UX patterns work for sharing plans and designs with customers?</text.span></li>
          </ol>
        </Box>

        <Box orientation="vertical" gap="sm">
          <text.p size={-1} className="font-semibold">Trade-offs</text.p>
          <text.p size={-1} emphasis="passive">
            This mode is for people willing to:
          </text.p>
          <ul className="list-disc pl-4 space-y-1">
            <li><text.span size={-1}>Prioritize completeness and quality over speed</text.span></li>
            <li><text.span size={-1}>Discuss what they want to build before seeing a site</text.span></li>
            <li><text.span size={-1}>Have enough credits available to build an entire site in one shot (200+)</text.span></li>
            <li><text.span size={-1}>Spend 15+ minutes to see the first version</text.span></li>
          </ul>
        </Box>

        <Box orientation="horizontal" gap="sm" inlineAlignChildren="end" blockPadding="sm">
          <Button design="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button design="primary" onClick={onConfirm}>
            Let&apos;s Build
          </Button>
        </Box>
      </Box>
    </Modal>
  )
}
