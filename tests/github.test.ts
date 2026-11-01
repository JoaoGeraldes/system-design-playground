import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatCount,
  toContributors,
  toStarCount,
} from '../src/landing/github.ts';

function contributor(login: string, type = 'User') {
  return {
    login,
    avatar_url: `https://avatars.githubusercontent.com/u/1?v=4`,
    html_url: `https://github.com/${login}`,
    contributions: 3,
    type,
  };
}

test('the star count is read from the repository', () => {
  assert.equal(toStarCount({ stargazers_count: 42 }), 42);
});

test('bots are left out of the contributors', () => {
  const people = toContributors([
    contributor('ada'),
    contributor('dependabot[bot]', 'Bot'),
  ]);
  assert.deepEqual(
    people.map((person) => person.login),
    ['ada'],
  );
});

test('contributors keep their order, profile and contribution count', () => {
  const [ada] = toContributors([contributor('ada')]);
  assert.equal(ada.profileUrl, 'https://github.com/ada');
  assert.equal(ada.contributions, 3);
});

test('avatars are asked for at twice their shown size, for sharp screens', () => {
  const [ada] = toContributors([contributor('ada')]);
  assert.equal(
    ada.avatarUrl,
    'https://avatars.githubusercontent.com/u/1?v=4&s=96',
  );
});

test('counts under a thousand are shown in full', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(950), '950');
});

test('counts in the thousands are shortened', () => {
  assert.equal(formatCount(1000), '1k');
  assert.equal(formatCount(1234), '1.2k');
  assert.equal(formatCount(15400), '15k');
});
