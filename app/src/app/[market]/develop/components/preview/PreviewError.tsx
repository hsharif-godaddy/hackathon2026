import Button from '@ux/button'
import RefreshIcon from '@ux/icon/refresh'

interface PreviewErrorProps {
  title: string
  error: string
  buttonText: string
  buttonOnClick: () => void
  secondaryButtonText?: string
  secondaryButtonOnClick?: () => void
  secondaryButtonDisabled?: boolean
}

export default function PreviewError({
  title,
  error,
  buttonText,
  buttonOnClick,
  secondaryButtonText,
  secondaryButtonOnClick,
  secondaryButtonDisabled,
}: PreviewErrorProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center">
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm mb-2 text-center max-w-md">
        {error}
      </p>
      <div className="flex flex-col items-center gap-2">
        <Button
          onClick={buttonOnClick}
          className="inline-flex items-center px-2 py-1 text-sm font-medium rounded-lg transition-colors"
          icon={<RefreshIcon />}
          design="tertiary"
          text={buttonText}
        />
        {secondaryButtonText && secondaryButtonOnClick && (
          <Button
            onClick={secondaryButtonOnClick}
            disabled={secondaryButtonDisabled}
            className="inline-flex items-center px-2 py-1 text-sm font-medium rounded-lg transition-colors"
            design="primary"
            text={secondaryButtonText}
          />
        )}
      </div>
    </div>
  )
}
