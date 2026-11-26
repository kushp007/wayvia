// Run after npm run build: node --test tests/collaboration-runtime.mjs
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { MSG } from 'deepspace/worker'
import { verifySharedTrip } from './shared-trip.ts'

const issuer = 'https://wayvia-runtime.test'
const appId = 'app_wayvia_runtime_test'
const home = 'http://wayvia.test'
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url')

async function serveBuiltAssets(request) {
  const path = new URL(request.url).pathname
  const file = path === '/' ? 'index.html' : path === '/_spa' ? '_spa.html' : path.slice(1)
  if (!/^(?:index\.html|_spa\.html|san-diego-coast\.png|assets\/[\w.-]+\.(?:js|css))$/.test(file)) {
    return new Response(null, { status: 404 })
  }
  const type = {
    html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png',
  }[file.split('.').at(-1)]
  const content = await readFile(new URL('../dist/client/' + file, import.meta.url)).catch(() => null)
  return content ? new Response(content, { headers: { 'Content-Type': type } }) : new Response(null, { status: 404 })
}

function token(id) {
  const header = encoded({ alg: 'ES256', typ: 'JWT' })
  const claims = encoded({ iss: issuer, sub: id, name: id, email: id + '@example.test', exp: Math.floor(Date.now() / 1000) + 600 })
  const input = header + '.' + claims
  return input + '.' + sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
}

async function createRuntime({ appId, browser = false, provider, outboundService }) {
  const config = JSON.parse(await readFile(new URL('../dist/wayvia/wrangler.json', import.meta.url), 'utf-8'))
  return new Miniflare(convertV4MiniflareOptions({
    name: 'wayvia-runtime-test',
    modules: true,
    scriptPath: 'dist/wayvia/index.js',
    ...(outboundService ? { outboundService } : {}),
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    bindings: {
      APP_NAME: 'wayvia-runtime-test',
      DEEPSPACE_APP_ID: browser ? config.vars.DEEPSPACE_APP_ID : appId,
      OWNER_USER_ID: 'platform-owner',
      AUTH_JWT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
      AUTH_JWT_ISSUER: issuer,
      ...(provider ? { APP_OWNER_JWT: token('platform-owner') } : {}),
    },
    durableObjects: Object.fromEntries(config.durable_objects.bindings.map(binding =>
      [binding.name, { className: binding.class_name, useSQLite: true }])),
    serviceBindings: {
      ASSETS: browser ? serveBuiltAssets : () => new Response(null, { status: 404 }),
      ...(provider ? { API_WORKER: provider } : {}),
    },
  }))
}

test('a failed automatic cover lookup allows immediate manual retry and live persisted attribution', { timeout: 35_000 }, async () => {
  const imageUrl = 'https://thumb.wikimedia.org/wikipedia/commons/test/skyline.jpg'
  const fileUrl = 'https://commons.wikimedia.org/wiki/File:Test_skyline.jpg'
  let searches = 0
  let releaseSearch
  const firstSearch = new Promise(resolve => { releaseSearch = resolve })
  const runtime = await createRuntime({ browser: true, outboundService: async request => {
    const url = new URL(request.url)
    if (url.href === imageUrl) {
      assert.equal(request.method, 'HEAD')
      return new Response(null, { headers: { 'Content-Type': 'image/jpeg' } })
    }
    assert.equal(url.hostname, 'commons.wikimedia.org')
    assert.equal(url.searchParams.get('gsrsearch'), 'New York City skyline filetype:bitmap')
    assert.match(request.headers.get('User-Agent') ?? '', /Wayvia.*wayvia\.app\.space/)
    if (++searches === 1) {
      await firstSearch
      return new Response(null, { status: 503 })
    }
    return Response.json({ query: { pages: [{
      title: 'File:Test skyline.jpg',
      imageinfo: [{ url: imageUrl, thumburl: imageUrl, descriptionurl: fileUrl, width: 1600, height: 900, size: 300000,
        mime: 'image/jpeg', extmetadata: { Artist: { value: 'Test photographer' }, LicenseShortName: { value: 'CC BY 4.0' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' } } }],
    }] } })
  } })
  let browser
  try {
    const baseURL = (await runtime.ready).origin
    browser = await chromium.launch({ executablePath: process.env.DEEPSPACE_TEST_BROWSER_EXECUTABLE_PATH })
    const page = await browser.newPage({ baseURL })
    page.setDefaultTimeout(8000)
    const id = 'cover-owner'
    await page.route('**/api/auth/get-session', route => route.fulfill({ json: {
      user: { id, name: 'Traveler', email: 'traveler@example.test' }, session: { id: 'session', userId: id },
    } }))
    await page.route('**/api/auth/token', route => route.fulfill({ json: { token: token(id) } }))
    await page.route(imageUrl, route => route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', contentType: 'image/svg+xml',
    }))
    await page.goto('/home')
    await page.getByRole('button', { name: 'Create your first trip' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Trip name').fill('New York photo test')
    await dialog.getByLabel('Destination').fill('New York City, NY')
    await dialog.getByLabel('Start date').fill('2027-03-13')
    await dialog.getByLabel('End date').fill('2027-03-15')
    await dialog.getByRole('button', { name: 'Create trip' }).click()
    await expect.poll(() => searches).toBe(1)
    async function findPhoto() {
      await page.getByRole('button', { name: 'Trip options' }).click()
      await page.getByRole('menuitem', { name: 'Find cover photo' }).click()
    }
    await findPhoto()
    await expect(page.getByText(/photo search is already in progress/)).toBeVisible()
    assert.equal(searches, 1)
    releaseSearch()
    await expect(async () => {
      await findPhoto()
      await expect(page.getByText('Trip photo updated.')).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 5000, intervals: [200] })
    await expect(page.locator('.trip-cover')).toHaveAttribute('src', imageUrl)
    await expect(page.locator('.trip-cover')).toBeVisible()
    await expect(page.locator('.cover-credit').first()).toContainText('Test photographer')
    await page.reload()
    await expect(page.locator('.trip-cover')).toHaveAttribute('src', imageUrl)
    await expect(page.getByRole('link', { name: 'Test skyline.jpg' })).toHaveAttribute('href', fileUrl)
    await expect(page.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/')
    assert.equal(searches, 2)
  } finally {
    releaseSearch()
    await browser?.close()
    await runtime.dispose()
  }
})

test('real Worker actions and DeepSpace subscriptions share a trip and revoke access atomically', { timeout: 30_000 }, async () => {
  const mf = await createRuntime({ appId })
  const sockets = []
  async function connect(id) {
    const response = await mf.dispatchFetch(home + '/ws/' + encodeURIComponent('app:' + appId) + '?token=' + token(id), {
      headers: { Upgrade: 'websocket' },
    })
    assert.equal(response.status, 101)
    const socket = response.webSocket
    assert.ok(socket)
    sockets.push(socket)
    const received = []
    const notifications = new EventTarget()
    socket.addEventListener('message', event => {
      received.push(JSON.parse(event.data))
      notifications.dispatchEvent(new Event('message'))
    })
    socket.accept()
    function waitFor(predicate) {
      return (async () => {
        const timeout = AbortSignal.timeout(7000)
        let message = received.find(predicate)
        while (!message) {
          await once(notifications, 'message', { signal: timeout })
          message = received.find(predicate)
        }
        return message
      })()
    }
    async function query(subscriptionId) {
      socket.send(JSON.stringify({ type: MSG.SUBSCRIBE, payload: { subscriptionId, query: { collection: 'trips' } } }))
      const message = await waitFor(frame => frame.type === MSG.QUERY_RESULT && frame.payload.subscriptionId === subscriptionId)
      return message.payload.records
    }
    return { waitFor, query, socket }
  }

  async function action(name, userId, details) {
    const response = await mf.dispatchFetch(home + '/api/actions/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: 'Bearer ' + token(userId) } : {}) },
      body: JSON.stringify(details),
    })
    return { status: response.status, result: await response.json() }
  }
  const changes = (recordId, predicate) => frame =>
    frame.type === MSG.RECORD_CHANGE && frame.payload.record.recordId === recordId && predicate(frame.payload)

  try {
    const [owner, friend, outsider] = await Promise.all(['owner', 'friend', 'outsider'].map(connect))
    await Promise.all([owner.query('owner-start'), friend.query('friend-start'), outsider.query('outsider-start')])
    const details = { title: 'Boston', destination: 'Boston', description: '', startDate: '2027-03-13', endDate: '2027-03-15', budget: 100, image: '', interests: [] }
    assert.equal((await action('trip-create', null, { details })).status, 401)
    const created = await action('trip-create', 'owner', { details })
    assert.equal(created.result.success, true, JSON.stringify(created.result))
    const { recordId } = created.result.data
    assert.deepEqual(await friend.query('before-join'), [])
    assert.equal((await action('invite-create', 'friend', { recordId })).result.success, false)
    const invitation = await action('invite-create', 'owner', { recordId })
    assert.equal(invitation.result.success, true, JSON.stringify(invitation.result))
    const { invite } = invitation.result.data
    const joined = await action('invite-accept', 'friend', { invite })
    assert.equal(joined.result.success, true, JSON.stringify(joined.result))
    const memberUpdate = await owner.waitFor(changes(recordId, change => change.record.data?.collaborators?.includes('friend')))
    assert.equal(memberUpdate.payload.record.createdBy, 'owner')
    assert.equal((await friend.query('joined'))[0].recordId, recordId)
    assert.deepEqual(await outsider.query('private'), [])

    owner.socket.send(JSON.stringify({ type: MSG.PUT, payload: {
      collection: 'trips', recordId, requestId: 'direct-write-must-fail', data: { collaborators: ['outsider'] },
    } }))
    const directWrite = await owner.waitFor(frame => frame.type === MSG.ACK && frame.payload.requestId === 'direct-write-must-fail')
    assert.equal(directWrite.payload.success, false)

    const createdActivity = await action('activity-create', 'friend', { recordId, details: {
      title: 'Museum', description: '', category: 'Sightseeing', location: '', cost: 25.50, duration: 60,
      source: '', image: '', date: '2027-03-14', time: '10:00',
    } })
    assert.equal(createdActivity.result.success, true, JSON.stringify(createdActivity.result))
    const update = await owner.waitFor(changes(recordId, change => Boolean(change.record.data?.activities?.length)))
    const activityId = update.payload.record.data.activities[0].id

    const votes = await Promise.all(['owner', 'friend', 'owner', 'friend'].map(id =>
      action('activity-vote', id, { recordId, activityId, active: true })))
    assert.ok(votes.every(vote => vote.result.success))
    for (const client of [owner, friend]) {
      const voteUpdate = await client.waitFor(changes(recordId, change => change.record.data?.activities?.[0]?.votes.length === 2))
      assert.deepEqual([...voteUpdate.payload.record.data.activities[0].votes].sort(), ['friend', 'owner'])
    }

    const removed = await action('member-remove', 'owner', { recordId, memberId: 'friend' })
    assert.equal(removed.result.success, true)
    await friend.waitFor(changes(recordId, change => change.changeType === 'delete'))
    assert.deepEqual(await friend.query('after-removal'), [])
    assert.equal((await action('activity-vote', 'friend', { recordId, activityId, active: true })).result.success, false)
    assert.equal((await action('invite-accept', 'friend', { invite })).result.success, false)
    assert.deepEqual(await outsider.query('still-private'), [])
  } finally {
    for (const socket of sockets) socket.close(1000, 'Test finished')
    await mf.dispose()
  }
})

test('the browser can load provider results and save them through validated trip actions', { timeout: 40_000 }, async () => {
  let weatherRequests = 0
  const runtime = await createRuntime({ browser: true, provider: async request => {
    const pathname = new URL(request.url).pathname
    const input = await request.json()
    assert.ok(request.headers.get('Authorization')?.startsWith('Bearer '))
    if (pathname.endsWith('/openweathermap/current')) {
      weatherRequests++
      assert.equal(input.location, 'New York,NY,US')
      return Response.json({ success: true, data: { dt: 1795654786, temp: 6.9, feels_like: 3.24, humidity: 67, description: 'clear sky', wind_speed: 6.17 } })
    }
    if (pathname.endsWith('/serpapi/places-search')) {
      assert.match(input.q, /museums .*New York City, NY/)
      return Response.json({ success: true, data: { local_results: [{ title: 'Art museum', rating: 4.5, address: 'New York', thumbnail: 'https://example.test/art.png' }] } })
    }
    return Response.json({ success: false, error: 'Unexpected route' }, { status: 404 })
  } })
  let browser
  try {
    const baseURL = (await runtime.ready).origin
    browser = await chromium.launch({ executablePath: process.env.DEEPSPACE_TEST_BROWSER_EXECUTABLE_PATH })
    const page = await browser.newPage({ baseURL, viewport: { width: 390, height: 760 } })
    page.setDefaultTimeout(8000)
    const id = 'integration-owner'
    await page.route('**/api/auth/get-session', route => route.fulfill({ json: {
      user: { id, name: 'Traveler', email: 'traveler@example.test' }, session: { id: 'session', userId: id },
    } }))
    await page.route('**/api/auth/token', route => route.fulfill({ json: { token: token(id) } }))
    await page.route('https://example.test/art.png', route => route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="navy"/></svg>',
      contentType: 'image/svg+xml',
    }))
    await page.goto('/home')
    await page.getByRole('button', { name: 'Create your first trip' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Trip name').fill('New York weekend')
    await dialog.getByLabel('Destination').fill('New York City, NY')
    await dialog.getByLabel('Start date').fill('2027-03-13')
    await dialog.getByLabel('End date').fill('2027-03-15')
    await dialog.getByRole('button', { name: 'Create trip' }).click()

    await page.getByRole('button', { name: 'Load current weather' }).click()
    await expect(page.getByText('clear sky')).toBeVisible()
    await expect(page.getByText('6.9 °C')).toBeVisible()
    await page.getByRole('button', { name: 'Refresh weather' }).click()
    await expect(page.getByRole('button', { name: 'Refresh weather' })).toBeEnabled()
    assert.equal(weatherRequests, 1)
    const direct = await page.request.post('/api/integrations/openweathermap/current', { headers: { Authorization: 'Bearer ' + token(id) }, data: {} })
    assert.equal(direct.status(), 403)

    await page.getByRole('tab', { name: 'Discover' }).click()
    await page.getByLabel('Search New York City, NY').fill('museums')
    await page.getByRole('button', { name: 'Search places' }).click()
    await expect(page.getByRole('heading', { name: 'Art museum' })).toBeVisible()
    await page.getByRole('button', { name: 'Use as trip cover' }).click()
    await expect(page.locator('.trip-cover')).toHaveAttribute('src', 'https://example.test/art.png')
    await page.getByRole('button', { name: 'Add to trip' }).click()
    await expect(dialog.getByLabel('Activity name')).toHaveValue('Art museum')
    await dialog.getByLabel('Estimated group cost (USD)').fill('20')
    await dialog.getByLabel('Itinerary date').fill('2027-03-14')
    await dialog.getByRole('button', { name: 'Save activity' }).click()
    await expect(dialog).toBeHidden()

    await page.getByRole('tab', { name: 'AI planner' }).click()
    await expect(page.getByText('AI Planner is pending')).toBeVisible()
    const pendingPlanner = await page.request.post('/api/actions/travel-plan', { headers: { Authorization: 'Bearer ' + token(id) }, data: {} })
    assert.equal(pendingPlanner.status(), 404)
    await page.getByRole('tab', { name: 'Discover' }).click()
    await page.getByRole('button', { name: 'Add an activity manually' }).click()
    await dialog.getByLabel('Activity name').fill('Morning walk')
    await dialog.getByRole('button', { name: 'Save activity' }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole('tab', { name: 'Budget' }).click()
    await expect(page.locator('.budget-numbers')).toContainText('$20')
  } finally {
    await browser?.close()
    await runtime.dispose()
  }
})


test('two browser sessions share activities and votes after preserving a signed-out invite', { timeout: 45_000 }, async () => {
  const runtime = await createRuntime({ browser: true })
  let browser
  const traces = []
  try {
    const baseURL = (await runtime.ready).origin
    browser = await chromium.launch({ executablePath: process.env.DEEPSPACE_TEST_BROWSER_EXECUTABLE_PATH })
    const owner = await browser.newPage({ baseURL })
    const guest = await browser.newPage({ baseURL })
    for (const view of [owner, guest]) {
      view.setDefaultTimeout(8000)
      view.on('pageerror', error => traces.push(error.message))
      view.on('response', response => traces.push(response.status() + ' ' + new URL(response.url()).pathname))
    }

    async function mockLogin(view, id, initial) {
      let signedIn = initial
      const user = { id, name: id, email: id + '@example.test' }
      // Stub the identity-provider round trip only. The real Worker verifies
      // the local JWTs and handles every action and WebSocket subscription.
      await view.route('**/api/auth/get-session', route => route.fulfill({
        json: signedIn ? { user, session: { id: id + '-session', userId: id } } : null,
      }))
      await view.route('**/api/auth/token', route => route.fulfill({ json: { token: token(id) } }))
      await view.route('**/api/auth/social-redirect?provider=google', route => {
        signedIn = true
        return route.fulfill({ status: 302, headers: { Location: baseURL + '/home' } })
      })
    }

    await mockLogin(owner, 'Alice', true)
    await mockLogin(guest, 'Bob', false)
    await verifySharedTrip(owner, guest, async () => {
      await guest.getByTestId('nav-sign-in-button').click()
      await guest.getByRole('button', { name: 'Continue with Google' }).click()
      await expect(guest).toHaveURL(baseURL + '/home')
    })
  } catch (error) {
    throw new Error(traces.join('\n'), { cause: error })
  } finally {
    await browser?.close()
    await runtime.dispose()
  }
})
