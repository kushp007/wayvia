import { expect, it, vi } from 'vitest'
import { commonsCandidates, findCommonsCover } from './commons-cover'

const file = {
  title: 'File:New York skyline.jpg', index: 1,
  imageinfo: [{
    url: 'https://upload.wikimedia.org/original.jpg', thumburl: 'https://upload.wikimedia.org/thumb.jpg',
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:New_York_skyline.jpg',
    width: 1600, height: 800, size: 600000, mime: 'image/jpeg',
    extmetadata: {
      Artist: { value: '<b>Example &amp; Authors</b>' },
      LicenseShortName: { value: 'CC BY-SA 4.0' },
      LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    },
  }],
}
const response = { query: { pages: [file] } }

it('keeps source attribution and rejects missing or unsafe metadata', () => {
  expect(commonsCandidates(response)[0].attribution).toMatchObject({ creator: 'Example & Authors', license: 'CC BY-SA 4.0' })
  const invalid = { ...file, imageinfo: [{ ...file.imageinfo[0], thumburl: 'http://example.test/a', url: 'https://example.test/a' }] }
  expect(commonsCandidates({ query: { pages: [invalid, { title: 'File:No metadata.jpg' }, file] } })).toHaveLength(1)
})

it('returns a cover only when the Wikimedia file resolves to an image', async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(response))
    .mockResolvedValueOnce(new Response(null, { headers: { 'Content-Type': 'image/jpeg' } }))
  expect(await findCommonsCover('New York City, NY', request)).toMatchObject({ status: 'found', cover: { image: file.imageinfo[0].thumburl } })
  expect(request.mock.calls[1][1]).toMatchObject({ method: 'HEAD', redirect: 'manual' })
  request.mockResolvedValueOnce(Response.json(response)).mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ batchcomplete: true }))
  expect(await findCommonsCover('New York City, NY', request)).toEqual({ status: 'not-found' })
  request.mockResolvedValueOnce(new Response(null, { status: 403 }))
  expect(await findCommonsCover('New York City, NY', request)).toEqual({ status: 'unavailable' })
})

it('rejects redirects without requesting the redirect target', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, {
    status: 302, headers: { Location: 'https://example.test/' },
  }))
  expect(await findCommonsCover('New York City, NY', request)).toEqual({ status: 'unavailable' })
  expect(request).toHaveBeenCalledTimes(1)
})
