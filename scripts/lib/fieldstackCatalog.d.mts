export type FieldstackSearchConfig = {
  allowPageParam: boolean;
  allowQueryParam: boolean;
  allowSortParam: boolean;
  baseUrl: string;
  categoryId: string | null;
  pageNumber: number;
  searchId: string;
  searchQuery: string | null;
  selectedSectionId: number;
  sortType: number;
};

export function parseFieldstackSearchConfig(
  html: unknown,
  pageUrl: string,
): FieldstackSearchConfig | null;
export function fieldstackResultsUrl(
  pageUrl: string,
  config: FieldstackSearchConfig,
  pageNumber: number,
): string;
export function parseFieldstackResultsPayload(value: unknown): {
  html: string;
  itemCountHtml: string;
  pageNumber: number;
  totalPages: number;
} | null;
export function parseFieldstackResultTotal(value: unknown): number | null;
