import { useEffect, useRef, useState } from 'react'

interface PosterImageProps {
  src: string | null | undefined
  alt: string
  className?: string
}

export function PosterImage({ src, alt, className }: PosterImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(src ? 'loading' : 'error')
  const imageRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    setStatus(src ? 'loading' : 'error')
  }, [src])

  useEffect(() => {
    const image = imageRef.current
    if (!src || !image) {
      return
    }

    if (!image.complete) {
      return
    }

    setStatus(image.naturalWidth > 0 ? 'loaded' : 'error')
  }, [src])

  const shellClassName = className ? `${className} poster-image-shell` : 'poster-image-shell'
  const mediaClassName = className ? `${className} poster-image-media` : 'poster-image-media'

  if (!src || status === 'error') {
    return (
      <div aria-label={alt} className={`${shellClassName} image-fallback`}>
        <span>No artwork</span>
      </div>
    )
  }

  return (
    <div className={shellClassName} data-status={status}>
      {status !== 'loaded' ? <div aria-hidden="true" className="loading-skeleton poster-image-skeleton" /> : null}
      <img
        alt={alt}
        className={mediaClassName}
        loading="lazy"
        ref={imageRef}
        src={src}
        onError={() => setStatus('error')}
        onLoad={() => setStatus('loaded')}
      />
    </div>
  )
}
