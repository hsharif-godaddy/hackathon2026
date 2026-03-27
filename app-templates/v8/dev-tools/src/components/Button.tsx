import React from 'react';

interface ButtonProps {
  text: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

function Button({
  text,
  onClick,
  variant = 'primary',
  loading = false,
  type = 'button',
}: ButtonProps) {
  const isPrimary = variant === 'primary';
  const isDisabled = loading;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      style={{
        backgroundColor: isPrimary ? '#6b46c1' : '#ffffff',
        color: isPrimary ? 'white' : '#6b46c1',
        padding: '0.5rem 1rem',
        borderRadius: '0.375rem',
        border: isPrimary ? 'none' : '2px solid #6b46c1',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s ease-in-out',
        fontSize: '0.875rem',
        fontWeight: '500',
        opacity: isDisabled ? 0.6 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (isDisabled) return;
        if (isPrimary) {
          e.currentTarget.style.backgroundColor = '#5a32b0';
        } else {
          e.currentTarget.style.backgroundColor = '#f5f3ff';
          e.currentTarget.style.borderColor = '#5a32b0';
        }
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (isDisabled) return;
        if (isPrimary) {
          e.currentTarget.style.backgroundColor = '#6b46c1';
        } else {
          e.currentTarget.style.backgroundColor = '#ffffff';
          e.currentTarget.style.borderColor = '#6b46c1';
        }
      }}
    >
      {loading && (
        <svg
          style={{
            animation: 'spin 1s linear infinite',
            width: '1rem',
            height: '1rem',
          }}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            style={{
              opacity: 0.25,
            }}
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            style={{
              opacity: 0.75,
            }}
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {text}
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `
      }} />
    </button>
  )
}

export default Button;
