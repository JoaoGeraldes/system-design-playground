export const REPO = 'JoaoGeraldes/system-design-playground';
export const REPO_URL = `https://github.com/${REPO}`;
const API = `https://api.github.com/repos/${REPO}`;

export interface Contributor {
  login: string;
  avatarUrl: string;
  profileUrl: string;
  contributions: number;
}

interface ApiRepo {
  stargazers_count: number;
}

interface ApiContributor {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
  type: string;
}

export function toStarCount(repo: ApiRepo): number {
  return repo.stargazers_count;
}

// Automated accounts like dependabot aren't people to thank.
export function toContributors(list: ApiContributor[]): Contributor[] {
  return list
    .filter((person) => person.type !== 'Bot')
    .map((person) => ({
      login: person.login,
      avatarUrl: sizedAvatar(person.avatar_url, 96),
      profileUrl: person.html_url,
      contributions: person.contributions,
    }));
}

/** 950 → "950", 1234 → "1.2k", 15000 → "15k". */
export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  const rounded = thousands < 10 ? thousands.toFixed(1) : thousands.toFixed(0);
  return `${rounded.replace(/\.0$/, '')}k`;
}

function sizedAvatar(url: string, size: number): string {
  const sized = new URL(url);
  sized.searchParams.set('s', String(size));
  return sized.toString();
}

export async function fetchStarCount(): Promise<number> {
  return toStarCount(await getJson(API));
}

export async function fetchContributors(): Promise<Contributor[]> {
  return toContributors(await getJson(`${API}/contributors?per_page=100`));
}

async function getJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return response.json();
}
