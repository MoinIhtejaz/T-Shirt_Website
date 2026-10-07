import { describe, expect, it } from 'vitest';
import { isAllowedAmazonUrl } from '../../src/security/index';

describe('isAllowedAmazonUrl: accepts', () => {
  it.each([
    'https://amazon.com.au/dp/B000000000',
    'https://www.amazon.com.au/Saltline-Tee/dp/B0ABCDEFGH?ref=sr_1_1&th=1',
    'https://amazon.com/',
    'https://www.amazon.com/gp/product/B000000000#reviews',
    'https://amzn.to/3xYzAbC',
    'https://amzn.asia/d/abc123',
    'https://amazon.com',
    'https://amazon.com?x=1',
    'https://www.amazon.com.au/s?k=t-shirt&i=fashion%20%E2%9C%93',
  ])('%s', (url) => {
    expect(isAllowedAmazonUrl(url)).toBe(true);
  });

  it.each([
    'https://WWW.AMAZON.COM.AU/dp/B000000000',
    'HTTPS://Amazon.Com/dp/x',
    'https://AMZN.TO/abc',
    'hTtPs://www.Amazon.com/',
  ])('accepts allowed hosts case-insensitively: %s', (url) => {
    expect(isAllowedAmazonUrl(url)).toBe(true);
  });

  it('accepts a URL of exactly 2048 characters', () => {
    const base = 'https://www.amazon.com/dp/B000000000?q=';
    const url = base + 'a'.repeat(2048 - base.length);
    expect(url).toHaveLength(2048);
    expect(isAllowedAmazonUrl(url)).toBe(true);
  });
});

describe('isAllowedAmazonUrl: rejects', () => {
  it.each([
    // wrong scheme
    ['http', 'http://www.amazon.com/dp/B000000000'],
    ['http upper', 'HTTP://amazon.com.au/'],
    ['javascript', 'javascript:alert(1)'],
    ['javascript with amazon text', 'javascript://amazon.com/%0aalert(1)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['data base64', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['ftp', 'ftp://amazon.com/'],
    ['file', 'file:///etc/passwd'],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['blob', 'blob:https://amazon.com/uuid'],
    ['protocol-relative', '//amazon.com/dp/B000000000'],
    ['protocol-relative www', '//www.amazon.com.au/'],
    ['no slashes', 'https:amazon.com/dp/x'],
    ['one slash', 'https:/amazon.com/dp/x'],
    ['three slashes', 'https:///amazon.com/dp/x'],
    ['relative path', '/dp/B000000000'],
    ['bare host', 'amazon.com/dp/B000000000'],
    ['wss', 'wss://amazon.com/'],

    // userinfo
    ['userinfo pointing elsewhere', 'https://amazon.com@evil.io/'],
    ['userinfo with password', 'https://amazon.com:pw@evil.io/'],
    ['userinfo on the real host', 'https://user@amazon.com/'],
    ['user and password on real host', 'https://user:pass@www.amazon.com/'],
    ['empty userinfo', 'https://@amazon.com/'],
    ['encoded at sign', 'https://amazon.com%40evil.io/'],

    // look-alike hosts
    ['suffix host', 'https://amazon.com.evil.io/'],
    ['au suffix host', 'https://amazon.com.au.evil.io/'],
    ['prefix host', 'https://evilamazon.com/'],
    ['subdomain of evil', 'https://www.amazon.com.evil.io/dp/x'],
    ['dash host', 'https://amazon-com.io/'],
    ['amazon.co', 'https://amazon.co/'],
    ['amazon.co.uk (not on list)', 'https://www.amazon.co.uk/'],
    ['other amazon subdomain', 'https://smile.amazon.com/'],
    ['other amazon subdomain au', 'https://m.amazon.com.au/'],
    ['amzn.com', 'https://amzn.com/'],
    ['trailing dot', 'https://amazon.com./'],
    ['typo', 'https://arnazon.com/'],
    ['IDN homograph (Cyrillic a)', 'https://аmazon.com/'],
    ['punycode homograph', 'https://xn--mazon-3ve.com/'],
    ['fullwidth letters', 'https://ａｍａｚｏｎ.com/'],
    ['percent-encoded host', 'https://%61mazon.com/'],
    ['IP address', 'https://54.239.28.85/'],
    ['localhost', 'https://localhost/'],
    ['explicit port', 'https://amazon.com:8443/'],
    ['explicit default port', 'https://amazon.com:443/'],
    ['host in path', 'https://evil.io/amazon.com'],
    ['host in query', 'https://evil.io/?u=https://amazon.com'],

    // whitespace and control-character tricks
    ['leading space', ' https://amazon.com/'],
    ['trailing space', 'https://amazon.com/ '],
    ['leading tab', '\thttps://amazon.com/'],
    ['newline in host', 'https://amaz\non.com/'],
    ['tab in host', 'https://amazon\t.com/'],
    ['carriage return in path', 'https://amazon.com/\r\nSet-Cookie:x'],
    ['NUL byte', 'https://amazon.com/\u0000'],
    ['leading control char', '\u0001https://amazon.com/'],
    ['DEL char', 'https://amazon.com/\u007f'],
    ['non-breaking space', 'https://amazon.com/ '],
    ['zero-width space', 'https://amazon.com​/'],
    ['right-to-left override', 'https://‮moc.nozama/'],
    ['space in path', 'https://amazon.com/a b'],
    ['newline split scheme', 'java\nscript:alert(1)'],

    // backslash tricks
    ['backslash before at', 'https://evil.io\\@amazon.com/'],
    ['backslash after host', 'https://amazon.com\\@evil.io/'],
    ['backslashes as slashes', 'https:\\\\amazon.com\\dp'],
    ['mixed slashes', 'https:/\\amazon.com/'],
    ['backslash in path', 'https://amazon.com/dp\\x'],

    // empty and overlong
    ['empty', ''],
    ['just scheme', 'https://'],
    ['only spaces', '   '],
  ])('%s', (_label, url) => {
    expect(isAllowedAmazonUrl(url)).toBe(false);
  });

  it('rejects URLs longer than 2048 characters', () => {
    const base = 'https://www.amazon.com/dp/B000000000?q=';
    const url = base + 'a'.repeat(2049 - base.length);
    expect(url).toHaveLength(2049);
    expect(isAllowedAmazonUrl(url)).toBe(false);
    expect(isAllowedAmazonUrl(base + 'a'.repeat(100_000))).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 42],
    ['object', { href: 'https://amazon.com/' }],
    ['URL instance', new URL('https://amazon.com/')],
    ['array', ['https://amazon.com/']],
    ['String object', Object('https://amazon.com/')],
    ['boolean', true],
  ])('rejects non-string input: %s', (_label, value) => {
    expect(isAllowedAmazonUrl(value as unknown as string)).toBe(false);
  });

  it('never throws', () => {
    const samples: unknown[] = ['https://[::1', 'https://%', 'https://\u0000', Symbol('x'), {}, 'https://a b.com'];
    for (const s of samples) expect(() => isAllowedAmazonUrl(s as string)).not.toThrow();
  });
});
