import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { SessionContext, type SessionContextValue } from '../session'
import { ShowPage } from './ShowPage'

const sessionValue: SessionContextValue = {
  password: '',
  setPassword: () => undefined,
  preferredTranslationType: 'sub',
  setPreferredTranslationType: () => undefined,
  autoNextEnabled: true,
  setAutoNextEnabled: () => undefined,
  autoSkipSegmentsEnabled: true,
  setAutoSkipSegmentsEnabled: () => undefined,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ShowPage', () => {
  it('renders the episode browser with progress and filler context', async () => {
    mockShowPageResponse(buildPayload())
    const user = userEvent.setup()

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Demo Show' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Episodes' }))
    expect(screen.getByPlaceholderText(/search episode number or title/i)).toBeInTheDocument()
    expect(screen.getByText(/3 episodes/i)).toBeInTheDocument()
    expect(screen.getByText(/tracking active/i)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /watched1/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /training day/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /what came before/i })).toHaveTextContent('Sub')
    expect(screen.getByText('Up next')).toBeInTheDocument()
  })

  it('filters the episode browser by search and filler state', async () => {
    mockShowPageResponse(buildPayload())
    const user = userEvent.setup()

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Demo Show' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Episodes' }))

    await user.type(screen.getByPlaceholderText(/search episode number or title/i), 'before')
    expect(screen.getByRole('link', { name: /what came before/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /training day/i })).not.toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText(/search episode number or title/i))
    await user.click(screen.getByRole('tab', { name: /filler1/i }))

    const episodeList = document.querySelector('.show-run-list')
    expect(episodeList).not.toBeNull()
    expect(within(episodeList as HTMLElement).getByRole('link', { name: /what came before/i })).toBeInTheDocument()
    expect(within(episodeList as HTMLElement).queryByRole('link', { name: /arrival/i })).not.toBeInTheDocument()
  })

  it('shows per-episode translation availability and keeps the filter rail on the right', async () => {
    mockShowPageResponse(buildPayload())
    const user = userEvent.setup()

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Demo Show' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Episodes' }))

    expect(screen.getByRole('link', { name: /arrival/i })).not.toHaveTextContent('Sub')
    expect(screen.getByRole('link', { name: /arrival/i })).not.toHaveTextContent('Dub')
    expect(screen.getByRole('link', { name: /what came before/i })).toHaveTextContent('Sub')

    const layout = document.querySelector('.show-run-layout')
    expect(layout?.firstElementChild).toHaveClass('show-run-main')
    expect(layout?.lastElementChild).toHaveClass('show-run-side')
  })
})

function renderPage() {
  render(
    <SessionContext.Provider value={sessionValue}>
      <MemoryRouter initialEntries={['/shows/demo-show?mode=sub']}>
        <Routes>
          <Route path="/shows/:showId" element={<ShowPage />} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  )
}

function mockShowPageResponse(payload: ReturnType<typeof buildPayload>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    if (url === '/api/shows/demo-show/page?translationType=sub') {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  })
}

function buildPayload() {
  return {
    show: {
      id: 'demo-show',
      provider: 'allanime',
      title: 'Demo Show',
      originalTitle: 'Sousou no Demo',
      bannerUrl: 'https://example.com/banner.jpg',
      posterUrl: 'https://example.com/poster.jpg',
      description: 'Provider description',
      genres: ['Action'],
      status: 'FINISHED',
      year: 2024,
      season: 'SPRING',
      score: 90,
      availableEpisodes: { sub: 3, dub: 2 },
    },
    aniListDetails: {
      mediaId: 101,
      siteUrl: 'https://anilist.co/anime/101',
      title: {
        romaji: 'Sousou no Frieren',
        native: '葬送のフリーレン',
      },
      synopsis:
        'Following the First-Class Mage Exam, the trio-Frieren, Fern, and Stark-heads north toward Aureole.',
      trailer: {
        id: 'demo-trailer',
        site: 'youtube',
        thumbnailUrl: 'https://img.youtube.com/vi/demo/hqdefault.jpg',
        videoUrl: 'https://www.youtube.com/watch?v=demo',
        embedUrl: 'https://www.youtube.com/embed/demo',
      },
      format: 'TV',
      status: 'FINISHED',
      episodes: 24,
      duration: 24,
      season: 'SPRING',
      seasonYear: 2024,
      startDate: { year: 2024, month: 4, day: 5 },
      endDate: { year: 2024, month: 9, day: 27 },
      averageScore: 91,
      popularity: 221004,
      favourites: 18230,
      genres: ['Adventure', 'Drama'],
      rankings: [{ rank: 3, type: 'RATED', context: 'Highest Rated All Time', season: null, year: null, allTime: true }],
      audienceStats: [
        { status: 'CURRENT', amount: 50312 },
        { status: 'PLANNING', amount: 110204 },
        { status: 'COMPLETED', amount: 82311 },
        { status: 'PAUSED', amount: 6230 },
        { status: 'DROPPED', amount: 1830 },
      ],
      tags: [{ name: 'Elf Protagonist', description: 'Features an elf lead.', category: 'Cast', rank: 88, isSpoiler: false }],
      relations: [
        {
          anilistId: 301,
          providerShowId: 'frieren-prequel',
          availableOnSite: true,
          title: 'Frieren: Beyond Journey End',
          originalTitle: 'Sousou no Frieren',
          posterUrl: 'https://example.com/relation.jpg',
          format: 'TV',
          status: 'FINISHED',
          season: 'FALL',
          year: 2023,
          score: 95,
          siteUrl: 'https://anilist.co/anime/301',
          relationType: 'PREQUEL',
        },
      ],
      recommendations: [
        {
          anilistId: 401,
          providerShowId: 'apothecary',
          availableOnSite: true,
          title: 'The Apothecary Diaries',
          originalTitle: 'Kusuriya no Hitorigoto',
          posterUrl: 'https://example.com/recommendation.jpg',
          format: 'TV',
          status: 'RELEASING',
          season: 'WINTER',
          year: 2024,
          score: 89,
          siteUrl: 'https://anilist.co/anime/401',
          rating: 145,
        },
      ],
      reviews: [],
    },
    translationType: 'sub' as const,
    malRank: 17,
    malPopularity: 317,
    episodes: [
      {
        showId: 'demo-show',
        number: '1',
        title: 'Arrival',
        translationType: 'sub' as const,
        durationSeconds: 1440,
        thumbnailUrl: null,
        progress: { currentTime: 1440, duration: 1440, completed: true, updatedAt: '2026-04-03T00:00:00.000Z' },
        isCurrent: false,
        annotation: null,
      },
      {
        showId: 'demo-show',
        number: '2',
        title: 'Training Day',
        translationType: 'sub' as const,
        durationSeconds: 1440,
        thumbnailUrl: null,
        progress: { currentTime: 540, duration: 1440, completed: false, updatedAt: '2026-04-03T00:00:00.000Z' },
        isCurrent: true,
        annotation: { isFiller: false, isRecap: false, source: 'jikan' as const },
      },
      {
        showId: 'demo-show',
        number: '3',
        title: 'What Came Before',
        translationType: 'sub' as const,
        durationSeconds: 1440,
        thumbnailUrl: null,
        progress: null,
        isCurrent: false,
        annotation: { isFiller: true, isRecap: true, source: 'jikan' as const },
      },
    ],
    progress: {
      completedEpisodeCount: 1,
      startedEpisodeCount: 2,
      currentEpisodeNumber: '2',
      currentTime: 540,
      latestEpisodeNumber: '3',
      updatedAt: '2026-04-03T00:00:00.000Z',
    },
    library: {
      showId: 'demo-show',
      title: 'Demo Show',
      posterUrl: 'https://example.com/poster.jpg',
      latestEpisodeNumber: '3',
      resumeEpisodeNumber: '2',
      resumeTime: 540,
      updatedAt: '2026-04-03T00:00:00.000Z',
      favorited: false,
      watchLater: false,
      completed: false,
      completedAt: null,
    },
    fillerSource: 'jikan' as const,
    fillerMatchTitle: 'Sousou no Frieren',
  }
}
