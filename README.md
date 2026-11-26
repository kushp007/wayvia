# Wayvia

Wayvia is a collaborative travel planner. Create a trip, share it with your group, collect and vote on ideas, and turn those ideas into a day-by-day itinerary with a shared budget.

**Live app** [wayvia.app.space](https://wayvia.app.space). The deployed version may differ from this branch until a release is approved.

## Features

- Google sign-in, private trips, expiring invitations, and traveler management
- A shared activity board, real-time voting, itinerary scheduling, and group budget estimates
- Destination search with a path to save results as activities or use an available image as the trip cover
- Automatic licensed destination photos from Wikimedia Commons. Trip owners can choose **Find cover photo** or **Refresh cover photo** from the trip menu.
- Current destination weather with city-name normalization and managed geocoding fallback

## Stack and architecture

React, TypeScript, Vite, React Router, Hono, and DeepSpace SDK 0.44.2 run on Cloudflare Workers. DeepSpace provides authentication, SQLite-backed records in a Durable Object, realtime WebSocket subscriptions, server actions, and the integration proxy.

The frontend subscribes to accessible trip records. Each trip holds membership, activities, schedules, and votes, so a single access policy protects the entire trip. The record room serializes mutations. Server actions validate changes before writing them, including trip membership, scheduled dates, and voting identity. Invitation tokens are random, stored as hashes, and expire after seven days. Member profiles exclude account emails.

Provider requests run in authenticated server actions outside the mutation queue. Each action checks trip access and builds its request from stored trip details. Wayvia uses the DeepSpace developer billing configuration, with explicit controls, per-user cooldowns, and in-flight guards. Direct browser calls to the travel provider routes are blocked. No provider API keys are required in the browser or repository.

| DeepSpace endpoint | Purpose |
| --- | --- |
| `serpapi/places-search` | Searches Google Maps places by destination and category, with images when available. |
| `exa/search` | Returns labeled web links and excerpts when the managed SerpApi account hits its search quota. |
| `openweathermap/current`, `openweathermap/geocoding` | Returns observed conditions and resolves city aliases when the direct weather lookup cannot find the city. |
| `openai/chat-completion` | Planner implementation retained. The product tab shows a pending state. |

## Local setup

Use Node.js 22.15+, 24, or 26 as specified in `package.json`, and npm 11.6+.

```sh
npm ci
npx deepspace auth login
npm run dev
```

Open the URL printed by the CLI. The CLI login configures developer access. Users sign in to Wayvia separately with Google. Google OAuth on a local origin depends on the platform’s allowed return URLs. For release and billing setup, use the [DeepSpace documentation](https://docs.deep.space/guides/external-apis).

## Testing

```sh
npm run type-check
npm run lint
npm run test:unit
npm run build
node --test tests/collaboration-runtime.mjs
npx deepspace test run smoke
npx deepspace test run api
npx deepspace test run e2e
```

The isolated runtime suite uses local signed test identities, a real DeepSpace RecordRoom, and Chromium. Install Playwright Chromium or point `DEEPSPACE_TEST_BROWSER_EXECUTABLE_PATH` at an existing Chrome executable. The account-backed browser suite requires two usable DeepSpace test accounts.

Use `npx deepspace integrations info <endpoint>` to inspect provider contracts. A live `integrations invoke` may consume credits. The isolated tests use fixtures for provider responses.

## Known limitations

- The managed SerpApi account returned a search-quota error. Exa was verified live as a fallback and provides labeled web results with source links. Travelers can add ideas manually regardless of provider availability.
- Commons photo searches are best effort. If a destination has no suitable verifiable photograph, the existing cover or neutral background stays in place. Commons covers credit the creator and link to the source and license.
- Weather shows current observations. The 15-minute cache is per Worker instance. Include a state or country to disambiguate cities. The native current-weather endpoint accepts a city query, so geocoding supplies a canonical city name and region instead of coordinates.
- AI Planner is pending in the product.
- The workspace limits trips to 32 travelers and 150 activities.

## Future enhancements

- Improve cover selection for ambiguous destination names and smaller destinations.
- Restore Maps ratings and image results when managed SerpApi quota is available.
