import { describe, expect, it } from 'vitest';
import { notificationFrom, safeTargetUrl } from './sw-push';

describe('notificationFrom', () => {
  it('turns the pushed JSON into a notification that remembers where to go', () => {
    const n = notificationFrom(
      JSON.stringify({
        title: 'Η συνδρομή λήγει',
        body: 'Σε 5 ημέρες',
        url: '/g/abc/myMembership',
      }),
    );
    expect(n).toEqual({
      title: 'Η συνδρομή λήγει',
      options: expect.objectContaining({
        body: 'Σε 5 ημέρες',
        data: { url: '/g/abc/myMembership' },
        icon: '/icon-192.png',
      }),
    });
  });

  it('shows a plain notification when the payload is missing or not JSON (a push must never be silent)', () => {
    for (const raw of [null, '', 'not json', '{"body":1}', '{"title":""}', '{"title":5}']) {
      const n = notificationFrom(raw);
      expect(n.title).toBe('Gym');
      expect(n.options.data).toEqual({ url: '/' });
    }
  });

  it('ignores a url that leaves the app', () => {
    const n = notificationFrom(
      JSON.stringify({ title: 'x', body: 'y', url: 'https://evil.example/' }),
    );
    expect(n.options.data).toEqual({ url: '/' });
  });
});

describe('notificationFrom with odd JSON', () => {
  it('still shows a plain notification for JSON that is not an object', () => {
    for (const raw of ['null', '42', '"text"', '[1]']) {
      expect(notificationFrom(raw).title).toBe('Gym');
    }
  });
});

describe('safeTargetUrl', () => {
  it('keeps a path of the app and refuses anything else', () => {
    expect(safeTargetUrl('/g/1/myMembership')).toBe('/g/1/myMembership');
    expect(safeTargetUrl('//evil.example')).toBe('/');
    expect(safeTargetUrl('https://evil.example')).toBe('/');
    expect(safeTargetUrl('javascript:alert(1)')).toBe('/');
    expect(safeTargetUrl(undefined)).toBe('/');
    expect(safeTargetUrl(42)).toBe('/');
    expect(safeTargetUrl('')).toBe('/');
    expect(safeTargetUrl('g/1')).toBe('/');
  });

  it('refuses paths that browsers read as another site', () => {
    for (const bad of ['/\\evil.example', '/\t/evil.example', '/\\\\evil.example']) {
      expect(safeTargetUrl(bad)).toBe('/');
    }
  });
});
