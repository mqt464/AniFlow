import { useId } from 'react'

interface RatingStarsProps {
  valuePercent: number
  starSize?: number
  className?: string
}

const STAR_PATH =
  'M12 2.35l2.97 6.02 6.64.97-4.8 4.68 1.13 6.62L12 17.77 6.06 20.64l1.13-6.62-4.8-4.68 6.64-.97L12 2.35z'

export function RatingStars({
  valuePercent,
  starSize = 13,
  className = 'show-canvas-rating-stars',
}: RatingStarsProps) {
  const clampedPercent = Math.max(0, Math.min(100, valuePercent))
  const clipIdBase = useId()

  return (
    <span aria-hidden="true" className={className}>
      {Array.from({ length: 5 }).map((_, index) => {
        const starFillPercent = Math.max(0, Math.min(100, ((clampedPercent - index * 20) / 20) * 100))
        const clipId = `${clipIdBase}-star-${index}`

        return (
          <span className="show-canvas-rating-star" key={index}>
            <svg className="show-canvas-rating-star-svg" viewBox="0 0 24 24" width={starSize} height={starSize}>
              <defs>
                <clipPath id={clipId}>
                  <rect x="0" y="0" width={24 * (starFillPercent / 100)} height="24" />
                </clipPath>
              </defs>
              <path className="show-canvas-rating-star-fill-path" d={STAR_PATH} clipPath={`url(#${clipId})`} />
              <path className="show-canvas-rating-star-outline" d={STAR_PATH} />
            </svg>
          </span>
        )
      })}
    </span>
  )
}
