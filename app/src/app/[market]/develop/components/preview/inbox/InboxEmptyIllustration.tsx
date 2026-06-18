interface InboxEmptyIllustrationProps {
  className?: string;
}

export function InboxEmptyIllustration({ className }: InboxEmptyIllustrationProps) {
  return (
    <svg
      width='160'
      height='116'
      viewBox='0 0 180 130'
      fill='none'
      role='presentation'
      aria-hidden='true'
      className={className}
    >
      <g
        stroke='currentColor'
        strokeWidth='2.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        {/* Chat bubble — a customer message */}
        <rect x='26' y='20' width='66' height='40' rx='11' fill='currentColor' fillOpacity='0.06' />
        <path d='M44 59 L40 72 L54 59' fill='currentColor' fillOpacity='0.06' />
        <path d='M40 36 H78 M40 46 H66' />

        {/* Contact form card — a submission */}
        <rect x='104' y='24' width='60' height='48' rx='8' />
        <rect x='112' y='33' width='30' height='6' rx='3' fill='currentColor' fillOpacity='0.12' stroke='none' />
        <path d='M112 50 H156 M112 59 H146' />

        {/* Inbox tray — where everything lands */}
        <rect x='28' y='80' width='124' height='44' rx='11' />
        <path d='M28 100 H62 L70 112 H110 L118 100 H152' />
      </g>

      {/* Sparkle dots — fresh / awaiting */}
      <g fill='currentColor' fillOpacity='0.5'>
        <circle cx='98' cy='14' r='2' />
        <circle cx='158' cy='16' r='2.5' />
        <circle cx='18' cy='74' r='2' />
      </g>
    </svg>
  );
}
