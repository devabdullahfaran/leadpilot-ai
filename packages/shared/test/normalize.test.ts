import { describe, expect, it } from 'vitest'
import { emailDomain, isFreeEmailDomain, normalizeEmail, normalizePhone, normalizeWebsite, normalizeWhitespace, websiteForStorage, WEBSITE_MAX_LENGTH } from '../src/normalize'

describe('normalizeEmail', () => {
  it('trims and lower-cases but keeps plus-addressing', () => {
    expect(normalizeEmail('  Ada.Lovelace@Example.COM ')).toBe('ada.lovelace@example.com')
    expect(normalizeEmail('a+sales@x.com')).toBe('a+sales@x.com')
  })
})

describe('normalizePhone', () => {
  it('keeps digits and a leading +', () => {
    expect(normalizePhone('+1 (555) 010-9999')).toBe('+15550109999')
    expect(normalizePhone(' 020 7946 0958 ')).toBe('02079460958')
  })
  it('returns null for empty or too-short input', () => {
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone(undefined)).toBeNull()
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('12-34-5')).toBeNull()
    expect(normalizePhone('1234567')).toBe('1234567')
  })
})

describe('normalizeWebsite', () => {
  it('adds https:// and strips the trailing slash and hash', () => {
    expect(normalizeWebsite('acme.com')).toBe('https://acme.com')
    expect(normalizeWebsite('http://acme.com/')).toBe('http://acme.com')
    expect(normalizeWebsite('https://acme.com/about/#team')).toBe('https://acme.com/about')
    expect(normalizeWebsite('  ACME.com/path?q=1 ')).toBe('https://acme.com/path?q=1')
  })
  it('returns null for empty or unusable input', () => {
    expect(normalizeWebsite(null)).toBeNull()
    expect(normalizeWebsite('   ')).toBeNull()
    expect(normalizeWebsite('localhost')).toBeNull()
    expect(normalizeWebsite('not a url')).toBeNull()
    expect(normalizeWebsite('javascript:alert(1)')).toBeNull()
  })
})

describe('email helpers', () => {
  it('extracts the lower-cased domain', () => {
    expect(emailDomain('x@Example.COM')).toBe('example.com')
    expect(emailDomain('no-at-sign')).toBe('')
  })
  it('detects free email providers', () => {
    expect(isFreeEmailDomain('someone@gmail.com')).toBe(true)
    expect(isFreeEmailDomain('cto@acme.example')).toBe(false)
  })
  it('collapses whitespace', () => {
    expect(normalizeWhitespace('  a \n\t b  ')).toBe('a b')
  })
})

describe('websiteForStorage', () => {
  it('stores the normalized URL when it fits', () => {
    expect(websiteForStorage('Example.com/')).toBe('https://example.com')
    expect(websiteForStorage(null)).toBeNull()
  })

  it('keeps the input when normalizing would exceed the column limit (security review regression)', () => {
    const long = `${'a'.repeat(WEBSITE_MAX_LENGTH - 10)}.example`
    expect(long.length).toBe(WEBSITE_MAX_LENGTH - 2)
    expect(websiteForStorage(long)).toBe(long)
  })

  it('keeps unparseable input as entered', () => {
    expect(websiteForStorage('not a url')).toBe('not a url')
  })
})
