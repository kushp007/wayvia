import { z } from 'zod/v4'
import type { CoverAttribution } from '../lib/cover'
import { weatherLocation, states } from './weather'

const agent = 'Wayvia/1.0 (https://wayvia.app.space)'
const metadata = z.object({ value: z.string() })
const imageInfo = z.object({
  url: z.string(), thumburl: z.string().optional(), descriptionurl: z.string(),
  width: z.number(), height: z.number(), size: z.number(), mime: z.string(),
  extmetadata: z.object({
    Artist: metadata.optional(), Attribution: metadata.optional(),
    LicenseShortName: metadata, LicenseUrl: metadata, Restrictions: metadata.optional(),
  }),
})
const files = z.object({
  query: z.object({
    pages: z.array(z.object({
      title: z.string(),
      index: z.number().optional(),
      imageinfo: z.array(z.unknown()).optional(),
    })),
  }).optional(),
})

export type CommonsCover = { image: string; attribution: CoverAttribution }
type CoverLookup = { status: 'found'; cover: CommonsCover } | { status: 'not-found' | 'unavailable' }

function safeUrl(raw: string, ...hosts: string[]) {
  if (!URL.canParse(raw) || raw.length > 2048) return undefined
  const url = new URL(raw)
  if (url.protocol === 'http:' && url.host === 'creativecommons.org') url.protocol = 'https:'
  if (url.protocol !== 'https:' || !hosts.includes(url.host) || url.username || url.password) return
  for (const key of ['utm_source', 'utm_campaign', 'utm_content']) url.searchParams.delete(key)
  return url.href
}

function plain(value: string) {
  return value.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, token =>
    ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&#39;': "'" })[token] ?? token)
    .trim().replace(/\s+/g, ' ')
}

export function commonsCandidates(input: unknown): CommonsCover[] {
  const parsed = files.safeParse(input)
  if (!parsed.success) return []
  return (parsed.data.query?.pages ?? []).sort((a, b) => (a.index ?? 99) - (b.index ?? 99)).flatMap(page => {
    const candidate = imageInfo.safeParse(page.imageinfo?.[0])
    if (!candidate.success) return []
    const info = candidate.data
    if (!['image/jpeg', 'image/webp'].includes(info.mime) || info.width < 800 || info.height < 350 || info.width / info.height < 1.25) return []
    const meta = info.extmetadata
    if (plain(meta.Restrictions?.value ?? '')) return []
    const licenseUrl = safeUrl(meta.LicenseUrl.value, 'creativecommons.org')
    if (!licenseUrl || !/^\/(?:licenses\/by(?:-sa)?\/[234]\.0|publicdomain\/zero\/1\.0)(?:\/deed\.[a-z-]+)?\/?$/.test(new URL(licenseUrl).pathname)) return []
    const creator = plain(meta.Attribution?.value || meta.Artist?.value || '')
    const fileUrl = safeUrl(info.descriptionurl, 'commons.wikimedia.org')
    const image = (info.thumburl && safeUrl(info.thumburl, 'thumb.wikimedia.org', 'upload.wikimedia.org')) ||
      (info.size <= 4_000_000 && safeUrl(info.url, 'upload.wikimedia.org'))
    const title = page.title.replace(/^File:/i, '')
    if (!creator || creator.length > 500 || !image || !fileUrl || title.length > 250) return []
    return [{ image, attribution: { title, creator, fileUrl, license: plain(meta.LicenseShortName.value), licenseUrl } }]
  })
}

export async function findCommonsCover(
  destination: string,
  request: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<CoverLookup> {
  const [city, region, country] = destination.split(',').map(value => value.replace(/[^\p{L}\p{N}\s.-]/gu, '').trim())
  if (!city) return { status: 'not-found' }
  const [, state, code] = weatherLocation(destination).split(',')
  const qualifier = code === 'US' ? states[state] ?? region : country || region
  const api = new URL('https://commons.wikimedia.org/w/api.php')
  const query = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrnamespace: '6', gsrlimit: '12',
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '960',
    iiextmetadatafilter: 'Artist|Attribution|LicenseShortName|LicenseUrl|Restrictions',
  })
  const regionHint = qualifier && !city.toLowerCase().includes(qualifier.toLowerCase()) ? qualifier : ''
  const signal = AbortSignal.timeout(4500)
  // workerd rejects the browser-style "error" mode before sending a request.
  // Manual mode plus the response.ok checks below still rejects all redirects.
  const init = { headers: { 'User-Agent': agent }, redirect: 'manual' as const, signal }
  let imageFailures = false
  try {
    for (const subject of ['skyline', 'landscape']) {
      query.set('gsrsearch', [city, regionHint, subject, 'filetype:bitmap'].filter(Boolean).join(' '))
      api.search = query.toString()
      const response = await request(api, init)
      if (!response.ok) {
        console.warn('[cover-lookup] Commons search rejected', { status: response.status })
        return { status: 'unavailable' }
      }
      const payload: unknown = await response.json()
      if (!files.safeParse(payload).success || !payload || typeof payload !== 'object' || 'error' in payload) {
        console.warn('[cover-lookup] Unexpected Commons search response')
        return { status: 'unavailable' }
      }
      const candidates = commonsCandidates(payload).slice(0, 3)
      const checked = await Promise.all(candidates.map(async candidate => {
        try {
          const image = await request(candidate.image, { ...init, method: 'HEAD' })
          if (image.ok && /^image\/(jpeg|webp)\b/i.test(image.headers.get('content-type') ?? '')) return candidate
          if (image.status !== 404 && image.status !== 410) {
            imageFailures = true
            console.warn('[cover-lookup] Commons image check rejected', { status: image.status })
          }
        } catch (error) {
          imageFailures = true
          console.warn('[cover-lookup] Commons image check failed', error instanceof Error ? error.name : 'Unknown')
        }
      }))
      const match = checked.find(Boolean)
      if (match) return { status: 'found', cover: match }
    }
  } catch (error) {
    console.warn('[cover-lookup] Commons lookup failed', error instanceof Error ? error.name : 'Unknown')
    return { status: 'unavailable' }
  }
  return { status: imageFailures ? 'unavailable' : 'not-found' }
}
