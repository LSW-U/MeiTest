/**
 * use-hot-search — 热搜管理 hooks（admin）
 *
 * 后端：apps/api/src/modules/search/search.controller.ts AdminHotSearchController
 *   - GET    /admin/hot-search              ZSET 热度榜 top N
 *   - GET    /admin/hot-search/terms        运营种子词列表
 *   - POST   /admin/hot-search/terms        新建
 *   - PATCH  /admin/hot-search/terms/:id    更新
 *   - DELETE /admin/hot-search/terms/:id    删除
 *   - GET    /admin/hot-search/zero-result  零结果词聚合
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

export type HotSearchType = 'PINNED' | 'MANUAL' | 'BLOCKED';
export type SearchLang = 'en' | 'zh' | 'id' | 'pt' | 'tet';

export interface HotSearchTerm {
  id: string;
  word: string;
  lang: string;
  type: HotSearchType;
  sortOrder: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHotSearchTermInput {
  word: string;
  lang: SearchLang;
  type: HotSearchType;
  sortOrder?: number;
  status?: string;
}

export interface UpdateHotSearchTermInput extends Partial<CreateHotSearchTermInput> {}

export interface ZsetItem {
  /** DataTable 行 key 占位（后端不返，DataTable 用 idx fallback） */
  id?: string;
  word: string;
  lang: string;
  searchCount: number;
}

export interface ZeroResultItem {
  /** DataTable 行 key 占位（后端不返，DataTable 用 idx fallback） */
  id?: string;
  word: string;
  lang: string;
  count: number;
}

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) sp.set(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useHotSearchTerms(lang?: string, type?: HotSearchType) {
  return useQuery({
    queryKey: ['hot-search-terms', lang, type],
    queryFn: () =>
      apiFetch<ApiSuccess<HotSearchTerm[]>>('/admin/hot-search/terms' + qs({ lang, type })),
  });
}

export function useHotSearchZset(lang?: string) {
  return useQuery({
    queryKey: ['hot-search-zset', lang],
    queryFn: () =>
      apiFetch<ApiSuccess<ZsetItem[]>>('/admin/hot-search' + qs({ lang, limit: '50' })),
  });
}

export function useZeroResult(lang?: string) {
  return useQuery({
    queryKey: ['hot-search-zero', lang],
    queryFn: () =>
      apiFetch<ApiSuccess<ZeroResultItem[]>>('/admin/hot-search/zero-result' + qs({ lang })),
  });
}

export function useCreateHotSearchTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHotSearchTermInput) =>
      apiFetch<ApiSuccess<HotSearchTerm>>('/admin/hot-search/terms', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hot-search-terms'] }),
  });
}

export function useUpdateHotSearchTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateHotSearchTermInput }) =>
      apiFetch<ApiSuccess<HotSearchTerm>>(`/admin/hot-search/terms/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hot-search-terms'] }),
  });
}

export function useDeleteHotSearchTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ApiSuccess<{ id: string }>>(`/admin/hot-search/terms/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hot-search-terms'] }),
  });
}
