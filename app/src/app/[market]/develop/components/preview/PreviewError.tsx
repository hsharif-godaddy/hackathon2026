import Button from '@ux/button'

interface PreviewErrorProps {
  title: string
  error: string
  buttonText: string
  buttonOnClick: () => void
}

export default function PreviewError({
  title,
  error,
  buttonText,
  buttonOnClick,
}: PreviewErrorProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center">
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm mb-2 text-center max-w-md">
        {error}
      </p>
      <Button
        onClick={buttonOnClick}
        design="primary"
        text={buttonText}
      />
    </div>
  )
}
