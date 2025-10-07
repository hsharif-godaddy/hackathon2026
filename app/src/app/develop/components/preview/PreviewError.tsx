import RefreshIcon from '@ux/icon/refresh'
import Button from '@ux/button'

export default function PreviewError({
  title,
  error,
  buttonText,
  buttonOnClick,
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm mb-4 text-center max-w-md">
        {error}
      </p>
      <Button
        onClick={buttonOnClick}
        className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors"
        icon={<RefreshIcon />}
        design="tertiary"
      >
        {buttonText}
      </Button>
    </div>
  )
}
