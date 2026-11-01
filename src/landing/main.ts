import {
  type Contributor,
  fetchContributors,
  fetchStarCount,
  formatCount,
} from './github.ts';

// Everything here is extra: if GitHub is unreachable or rate-limits the
// visitor, the star count and the contributors section simply stay hidden.

async function showStars() {
  const count = await fetchStarCount();
  const link = document.querySelector<HTMLElement>('[data-stat="stars"]');
  if (!link) return;
  link.querySelector('.repo-stat-count')!.textContent = formatCount(count);
  link.title = `${count.toLocaleString()} stars on GitHub`;
  link.setAttribute('aria-label', link.title);
  link.hidden = false;
}

async function showContributors() {
  const contributors = await fetchContributors();
  const section = document.getElementById('contributors');
  if (!section || contributors.length === 0) return;
  section.querySelector('ul')!.append(...contributors.map(contributorItem));
  section.hidden = false;
}

function contributorItem(person: Contributor) {
  const plural = person.contributions === 1 ? '' : 's';
  const link = document.createElement('a');
  link.href = person.profileUrl;
  link.title = `${person.login}, ${person.contributions} contribution${plural}`;

  const avatar = document.createElement('img');
  avatar.src = person.avatarUrl;
  avatar.alt = person.login;
  avatar.width = avatar.height = 48;
  avatar.loading = 'lazy';
  link.append(avatar);

  const item = document.createElement('li');
  item.append(link);
  return item;
}

showStars().catch(() => {});
showContributors().catch(() => {});
