
import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { tripsSchema } from './schemas/trips-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  tripsSchema,
]
