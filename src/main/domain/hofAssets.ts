const HOF_ASSET_BASE_URL = 'https://hof.zerosic.com/';

/**
 * HOF 원본 HTML에서 파싱한 이미지 경로를 앱에서 바로 열 수 있는 절대 URL로 바꾼다.
 *
 * @remarks
 * 원본 서버가 상대 경로나 `//host/path` 형태를 섞어 내려줄 수 있어서 화면 표시 전에 한 번 정규화한다.
 */
export function normalizeHofAssetUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  const migrated = value.replace(/^(?:(?:https?:)?\/\/sic\.zerosic\.com)?\/ZeroHOF\//i, '');
  if (migrated !== value) return new URL(migrated, HOF_ASSET_BASE_URL).toString();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;

  try {
    return new URL(value, HOF_ASSET_BASE_URL).toString();
  } catch {
    return value;
  }
}
