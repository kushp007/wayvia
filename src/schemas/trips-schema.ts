
import type { CollectionSchema } from 'deepspace/schema'

export const tripsSchema: CollectionSchema = {
  name: 'trips',

  collaboratorsField: 'collaborators',

  columns: [
    {
      name: 'title',
      storage: 'text',
      interpretation: 'plain',
      required: true,
    },
    {
      name: 'destination',
      storage: 'text',
      interpretation: 'plain',
      required: true,
    },
    {
      name: 'description',
      storage: 'text',
      interpretation: 'plain',
      default: '',
    },
    {
      name: 'startDate',
      storage: 'text',
      interpretation: 'plain',
      required: true,
    },
    {
      name: 'endDate',
      storage: 'text',
      interpretation: 'plain',
      required: true,
    },
    {
      name: 'budget',
      storage: 'number',
      interpretation: {
        kind: 'currency',
        symbol: '$',
        decimals: 2,
      },
      default: 0,
    },
    {
      name: 'image',
      storage: 'text',
      interpretation: 'plain',
      default: '/san-diego-coast.png',
    },
    {
      name: 'collaborators',
      storage: 'text',
      interpretation: { kind: 'json' },
      default: [],
    },
    {
      name: 'status',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: ['planning', 'upcoming', 'completed'],
      },
      default: 'planning',
    },
  ],

  permissions: {
    '*': {
      read: false,
      create: false,
      update: false,
      delete: false,
    },

    viewer: {
      read: false,
      create: false,
      update: false,
      delete: false,
    },

    member: {
      read: 'collaborator',
      create: true,
      update: 'own',
      delete: 'own',
    },

    admin: {
      read: 'collaborator',
      create: true,
      update: 'own',
      delete: 'own',
    },
  },
}
