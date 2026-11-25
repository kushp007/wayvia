import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'

import { tripActions } from './trips'

export const actions: Record<string, ActionHandler<Env>> = tripActions
