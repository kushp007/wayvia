import type { ActivityInput } from './collaboration'

export type Place = Pick<ActivityInput, 'title' | 'description' | 'category' | 'location' | 'image' | 'source'> & {
  id: string
  rating?: number
  origin?: 'web'
}

export type Weather = {
  observedAt: number
  temperature: number
  feelsLike: number
  humidity: number
  windSpeed: number
  conditions: string
}

export type Recommendation = ActivityInput
