/**
 * Multi-user collaboration spec — verifies two users sign in into
 * separate browser contexts and the app distinguishes them.
 *
 * `users(2)` takes any two accounts from your pool, so this spec passes on a
 * fresh app with no setup beyond having two test accounts:
 *   npx deepspace test accounts list
 *   npx deepspace test accounts create --email a@deepspace.test --name "A" --password-stdin
 *
 * Ask for accounts *by name* (`users(['Alice', 'Bob'])`) only when the
 * behaviour under test depends on which identity acts — otherwise naming them
 * couples the spec to one machine's pool.
 *
 * The `users` fixture handles sign-in caching (per-account storageState
 * persisted to `~/.deepspace/playwright-states/`), context creation, and
 * cleanup. No need to manage browser contexts manually.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { verifySharedTrip } from './shared-trip'

// A machine that has never created test accounts is the normal state of a
// fresh checkout, and there `users()` throws — turning "you have no pool yet"
// into three red tests about the app, which it is not. Skip the file instead
// and say what creates the pool. The count is of accounts usable HERE: the
// pool is global per developer, but passwords live only on the machine that
// created the account.
const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)

  // /home is dynamic (under src/pages/(app)/), so it mounts the nav shell;
  // '/' is the static landing and has no navigation.
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  // Email, not name. The page renders the *session's* `name || email`, while
  // `user.name` here comes from the LOCAL account registry — and the two are
  // not the same fact: a display name is optional, and an account recovered on
  // another machine has none stored locally at all. The email is the credential
  // the context signed in with, so it is the one identity both sides agree on,
  // and asserting it proves the page is showing THIS browser's account.
  // The two accounts are distinct, so two exact matches is also the proof that
  // the contexts are not sharing one session.
  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    // The identity chip shows `name || email`. Its text is not predictable, but
    // its presence is: something must be there once the profile has loaded.
    // (It is `hidden sm:inline` in some templates, so assert text, not
    // visibility.)
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })

    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

test('API status page renders loading success and error states', async ({ users }) => {
  const [user] = await users(1)
  let shouldFail = false
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    if (shouldFail) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
      })
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { integrations: { openai: {}, wikipedia: {} } } }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()
  await expect(user.page.getByText('2 integrations available.')).toBeVisible()

  shouldFail = true
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect(user.page.getByText('Catalog unavailable')).toBeVisible()
  await expect(user.page.getByText('Showing the last loaded catalog')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('API status page shows local retry after first-load API failure', async ({ users }) => {
  const [user] = await users(1)
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Could not load API data')).toBeVisible()
  await expect(user.page.getByText('Retried 1 time automatically.')).toBeVisible()

  const retryButton = user.page.getByRole('button', { name: 'Retry' })
  await expect(retryButton).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await retryButton.click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('trips persist across reloads and stay private to their owner', async ({ users }) => {
  const [owner, other] = await users(2)
  const first = 'New York ' + crypto.randomUUID()
  const second = 'Lisbon ' + crypto.randomUUID()
  const page = owner.page
  const sidebar = page.locator('aside')
  await Promise.all([page.goto('/home'), other.page.goto('/home')])
  await expect(other.page.getByTestId('nav-user-name')).toHaveText(/\S/)

  async function createTrip(title: string, destination: string) {
    await sidebar.getByRole('button', { name: 'New trip' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Trip name').fill(title)
    await dialog.getByLabel('Destination').fill(destination)
    await dialog.getByLabel('Start date').fill('2027-03-13')
    await dialog.getByLabel('End date').fill('2027-03-15')
    await dialog.getByRole('button', { name: 'Create trip' }).click()
    await expect(sidebar.getByRole('button', { name: title })).toBeVisible()
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
  }

  async function deleteSelected() {
    await page.getByRole('button', { name: 'Trip options' }).click()
    await page.getByRole('menuitem', { name: 'Delete trip' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete trip' }).click()
  }

  await createTrip(first, 'New York City')
  await createTrip(second, 'Lisbon')
  await other.page.reload()
  await expect(other.page.getByRole('button', { name: 'New trip' })).toBeEnabled()
  await expect(other.page.getByRole('button', { name: first })).toHaveCount(0)
  await expect(other.page.getByRole('button', { name: second })).toHaveCount(0)

  await sidebar.getByRole('button', { name: first }).click()
  await expect(page.locator('.trip-hero')).toContainText('Mar 13')
  await page.getByRole('button', { name: 'Trip options' }).click()
  await page.getByRole('menuitem', { name: 'Edit trip details' }).click()
  await page.getByRole('dialog').getByLabel('Description').fill('A weekend in Manhattan')
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('A weekend in Manhattan')).toBeVisible()
  await page.getByRole('tab', { name: 'Budget' }).click()
  await page.getByRole('button', { name: 'Edit budget' }).click()
  await page.getByRole('dialog').getByLabel('Estimated group budget (USD)').fill('975.50')
  await page.getByRole('button', { name: 'Save budget' }).click()
  await expect(page.getByRole('status')).toHaveText(/Group budget saved/)
  await page.reload()
  await sidebar.getByRole('button', { name: first }).click()
  await expect(page.getByText('A weekend in Manhattan')).toBeVisible()
  await page.getByRole('tab', { name: 'Budget' }).click()
  await expect(page.locator('.budget-numbers')).toContainText('$975.50')

  await deleteSelected()
  await expect(sidebar.getByRole('button', { name: first })).toHaveCount(0)
  await sidebar.getByRole('button', { name: second }).click()
  await expect(page.getByText('A weekend in Manhattan')).toHaveCount(0)
  await deleteSelected()
  await expect(sidebar.getByRole('button', { name: second })).toHaveCount(0)
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByTestId('nav-sign-in-button')).toBeVisible()
  await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
})

test('trip members see shared plans and votes live, then lose access on removal', async ({ users }) => {
  const [owner, friend] = await users(2)
  await verifySharedTrip(owner.page, friend.page)
})
