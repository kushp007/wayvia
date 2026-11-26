import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'

import { tripActions } from './trips'
import { collaborationActions } from './collaboration'
import { travelActions } from './travel'

export const actions: Record<string, ActionHandler<Env>> = {
  ...tripActions,
  ...collaborationActions,
  'travel-search': travelActions['travel-search'],
  'travel-weather': travelActions['travel-weather'],
}
