/**
 * 热搜管理页 — /hot-search（platform 视角）
 *
 * 3 tab：
 *  - 运营词条：HotSearchTerm CRUD（PINNED 置顶 / MANUAL 种子 / BLOCKED 屏蔽）
 *  - ZSET 热度榜：实时 Redis ZSET top（只读，真实 searchCount）
 *  - 零结果词：用户搜了但 0 结果（只读，运营补商品依据）
 *
 * 后端 AdminHotSearchController /admin/hot-search/*
 */
'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { ApiError } from '@/lib/api';
import {
  useHotSearchTerms,
  useHotSearchZset,
  useZeroResult,
  useCreateHotSearchTerm,
  useUpdateHotSearchTerm,
  useDeleteHotSearchTerm,
  type HotSearchTerm,
  type HotSearchType,
  type SearchLang,
} from '@/hooks/api/use-hot-search';

const TYPES: HotSearchType[] = ['PINNED', 'MANUAL', 'BLOCKED'];
const LANGS: SearchLang[] = ['en', 'zh', 'id', 'pt', 'tet'];
/** 顶级哨兵：lang/type 筛选 Select 的"全部"选项（Radix Select 不允许空 value） */
const ALL = '__all__';

/** type → 本地化文案（完整 i18n key，避免动态拼接） */
function useTypeLabel() {
  const t = useTranslations('common');
  return (tp: HotSearchType) =>
    tp === 'PINNED'
      ? t('admin.hotSearch.typePinned')
      : tp === 'MANUAL'
        ? t('admin.hotSearch.typeManual')
        : t('admin.hotSearch.typeBlocked');
}

/** lang → 本地化文案 */
function useLangLabel() {
  const t = useTranslations('common');
  return (lg: string) =>
    lg === 'en'
      ? t('admin.hotSearch.langEn')
      : lg === 'zh'
        ? t('admin.hotSearch.langZh')
        : lg === 'id'
          ? t('admin.hotSearch.langId')
          : lg === 'pt'
            ? t('admin.hotSearch.langPt')
            : t('admin.hotSearch.langTet');
}

export default function HotSearchPage() {
  const t = useTranslations('common');
  const typeLabel = useTypeLabel();
  const langLabel = useLangLabel();

  const [langFilter, setLangFilter] = useState<string>(''); // '' = 全部
  const termsQ = useHotSearchTerms(langFilter || undefined);
  const zsetQ = useHotSearchZset(langFilter || undefined);
  const zeroQ = useZeroResult(langFilter || undefined);
  const createMutation = useCreateHotSearchTerm();
  const updateMutation = useUpdateHotSearchTerm();
  const deleteMutation = useDeleteHotSearchTerm();

  const termColumns: Column<HotSearchTerm>[] = [
    { key: 'word', header: t('admin.hotSearch.columnWord'), render: (r) => <span className="font-medium">{r.word}</span> },
    { key: 'lang', header: t('admin.hotSearch.columnLang'), render: (r) => <span className="text-muted-foreground">{langLabel(r.lang)}</span> },
    {
      key: 'type', header: t('admin.hotSearch.columnType'),
      render: (r) => <Badge variant={r.type === 'BLOCKED' ? 'destructive' : r.type === 'PINNED' ? 'default' : 'secondary'}>{typeLabel(r.type)}</Badge>,
    },
    { key: 'sortOrder', header: t('admin.hotSearch.columnSort'), render: (r) => <span className="text-muted-foreground">{r.sortOrder}</span> },
    { key: 'status', header: t('admin.hotSearch.columnStatus'), render: (r) => <StatusBadge status={r.status} label={r.status === 'ACTIVE' ? t('admin.hotSearch.statusActive') : t('admin.hotSearch.statusInactive')} /> },
  ];

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={t('admin.hotSearch.title') as string}
        description={t('admin.hotSearch.listDesc')}
        action={
          <div className="flex items-center gap-2">
            <Select
              value={langFilter || ALL}
              onValueChange={(v) => setLangFilter(v === ALL ? '' : v)}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('admin.hotSearch.columnLang')}</SelectItem>
                {LANGS.map((lg) => (
                  <SelectItem key={lg} value={lg}>
                    {langLabel(lg)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('admin.hotSearch.newTerm')}
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="terms">
        <TabsList>
          <TabsTrigger value="terms">{t('admin.hotSearch.tabTerms')}</TabsTrigger>
          <TabsTrigger value="zset">{t('admin.hotSearch.tabZset')}</TabsTrigger>
          <TabsTrigger value="zero">{t('admin.hotSearch.tabZeroResult')}</TabsTrigger>
        </TabsList>

        {/* 运营词条 CRUD */}
        <TabsContent value="terms" className="space-y-4">
          {termsQ.isLoading ? (
            <LoadingSkeleton lines={5} />
          ) : termsQ.error ? (
            <ErrorState message={termsQ.error.message} onRetry={() => termsQ.refetch()} />
          ) : (
            <DataTable
              data={termsQ.data?.data ?? []}
              columns={termColumns}
              emptyState={
                <EmptyState
                  title={t('admin.hotSearch.emptyTitle')}
                  description={t('admin.hotSearch.emptyDesc')}
                />
              }
              rowActions={(row) => (
                <div className="flex justify-end gap-1">
                  <EditTermDialog
                    term={row}
                    onSave={(input) => updateMutation.mutate({ id: row.id, input })}
                    pending={updateMutation.isPending}
                  />
                  <DeleteTermDialog
                    term={row}
                    pending={deleteMutation.isPending}
                    onConfirm={() => deleteMutation.mutateAsync(row.id)}
                  />
                </div>
              )}
            />
          )}
        </TabsContent>

        {/* ZSET 热度榜（只读） */}
        <TabsContent value="zset" className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('admin.hotSearch.zsetDesc')}</p>
          {zsetQ.isLoading ? (
            <LoadingSkeleton lines={5} />
          ) : zsetQ.error ? (
            <ErrorState message={zsetQ.error.message} onRetry={() => zsetQ.refetch()} />
          ) : (
            <DataTable
              data={zsetQ.data?.data ?? []}
              columns={[
                { key: 'word', header: t('admin.hotSearch.columnWord'), render: (r) => <span className="font-medium">{r.word}</span> },
                { key: 'lang', header: t('admin.hotSearch.columnLang'), render: (r) => <span className="text-muted-foreground">{langLabel(r.lang)}</span> },
                { key: 'searchCount', header: t('admin.hotSearch.columnSearchCount'), render: (r) => <span className="font-mono text-xs">{r.searchCount}</span> },
              ]}
              emptyState={<EmptyState title={t('admin.hotSearch.emptyTitle')} description={t('admin.hotSearch.zsetDesc')} />}
            />
          )}
        </TabsContent>

        {/* 零结果词（只读） */}
        <TabsContent value="zero" className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('admin.hotSearch.zeroResultDesc')}</p>
          {zeroQ.isLoading ? (
            <LoadingSkeleton lines={5} />
          ) : zeroQ.error ? (
            <ErrorState message={zeroQ.error.message} onRetry={() => zeroQ.refetch()} />
          ) : (
            <DataTable
              data={zeroQ.data?.data ?? []}
              columns={[
                { key: 'word', header: t('admin.hotSearch.columnWord'), render: (r) => <span className="font-medium">{r.word}</span> },
                { key: 'lang', header: t('admin.hotSearch.columnLang'), render: (r) => <span className="text-muted-foreground">{langLabel(r.lang)}</span> },
                { key: 'count', header: t('admin.hotSearch.columnCount'), render: (r) => <span className="font-mono text-xs">{r.count}</span> },
              ]}
              emptyState={<EmptyState title={t('admin.hotSearch.emptyTitle')} description={t('admin.hotSearch.zeroResultDesc')} />}
            />
          )}
        </TabsContent>
      </Tabs>

      <CreateTermDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(input) => createMutation.mutate(input)}
        pending={createMutation.isPending}
        error={createMutation.error?.message}
      />
    </>
  );
}

function TypeSelect({ value, onChange }: { value: HotSearchType; onChange: (v: HotSearchType) => void }) {
  const label = useTypeLabel();
  return (
    <Select value={value} onValueChange={(v) => onChange(v as HotSearchType)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {TYPES.map((tp) => (
          <SelectItem key={tp} value={tp}>{label(tp)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LangSelect({ value, onChange }: { value: SearchLang; onChange: (v: SearchLang) => void }) {
  const label = useLangLabel();
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SearchLang)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {LANGS.map((lg) => (
          <SelectItem key={lg} value={lg}>{label(lg)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateTermDialog({
  open, onOpenChange, onCreate, pending, error,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (input: { word: string; lang: SearchLang; type: HotSearchType; sortOrder?: number; status?: string }) => void;
  pending: boolean;
  error?: string;
}) {
  const t = useTranslations('common');
  const [word, setWord] = useState('');
  const [lang, setLang] = useState<SearchLang>('en');
  const [type, setType] = useState<HotSearchType>('MANUAL');
  const [sortOrder, setSortOrder] = useState('0');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  useEffect(() => {
    if (!open) {
      setWord(''); setLang('en'); setType('MANUAL'); setSortOrder('0'); setStatus('ACTIVE');
    }
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim()) return;
    onCreate({ word, lang, type, sortOrder: parseInt(sortOrder, 10) || 0, status });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('admin.hotSearch.newTerm')}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label>{t('admin.hotSearch.formWord')} <span className="text-destructive">*</span></Label>
            <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder={t('admin.hotSearch.wordPlaceholder')} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('admin.hotSearch.formLang')}</Label>
              <LangSelect value={lang} onChange={setLang} />
            </div>
            <div className="space-y-1">
              <Label>{t('admin.hotSearch.formType')}</Label>
              <TypeSelect value={type} onChange={setType} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('admin.hotSearch.formSortOrder')}</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={status === 'ACTIVE'} onCheckedChange={(c) => setStatus(c ? 'ACTIVE' : 'INACTIVE')} />
              <Label>{status === 'ACTIVE' ? t('admin.hotSearch.statusActive') : t('admin.hotSearch.statusInactive')}</Label>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('admin.hotSearch.editCancel')}</Button>
            <Button type="submit" disabled={pending}>{pending ? t('admin.hotSearch.creating') : t('admin.hotSearch.createSubmit')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditTermDialog({
  term, onSave, pending,
}: {
  term: HotSearchTerm;
  onSave: (input: { word?: string; lang?: SearchLang; type?: HotSearchType; sortOrder?: number; status?: string }) => void;
  pending: boolean;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState(term.word);
  const [lang, setLang] = useState<SearchLang>(term.lang as SearchLang);
  const [type, setType] = useState<HotSearchType>(term.type);
  const [sortOrder, setSortOrder] = useState(String(term.sortOrder));
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(term.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE');

  useEffect(() => {
    if (open) {
      setWord(term.word); setLang(term.lang as SearchLang); setType(term.type);
      setSortOrder(String(term.sortOrder)); setStatus(term.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ word, lang, type, sortOrder: parseInt(sortOrder, 10) || 0, status });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('admin.hotSearch.editDialogTitle')}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label>{t('admin.hotSearch.formWord')}</Label>
            <Input value={word} onChange={(e) => setWord(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>{t('admin.hotSearch.formLang')}</Label><LangSelect value={lang} onChange={setLang} /></div>
            <div className="space-y-1"><Label>{t('admin.hotSearch.formType')}</Label><TypeSelect value={type} onChange={setType} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>{t('admin.hotSearch.formSortOrder')}</Label><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={status === 'ACTIVE'} onCheckedChange={(c) => setStatus(c ? 'ACTIVE' : 'INACTIVE')} />
              <Label>{status === 'ACTIVE' ? t('admin.hotSearch.statusActive') : t('admin.hotSearch.statusInactive')}</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('admin.hotSearch.editCancel')}</Button>
            <Button type="submit" disabled={pending}>{t('admin.hotSearch.editSave')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 删除词条（mutateAsync + await + try/catch，套用 feedback-delete-dialog-mutate-async 教训） */
function DeleteTermDialog({
  term, pending, onConfirm,
}: {
  term: HotSearchTerm;
  pending: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const { toast } = useToast();
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);

  const handleConfirm = async () => {
    try {
      await onConfirm();
      setOpen(false);
      toast({ title: t('admin.hotSearch.deleted'), description: term.word, variant: 'info' });
    } catch (err) {
      toast({
        title: t('admin.hotSearch.deleteTitle'),
        description: err instanceof ApiError ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" disabled={pending}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('admin.hotSearch.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('admin.hotSearch.deleteDesc')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('admin.hotSearch.deleteCancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? t('admin.hotSearch.deleting') : t('admin.hotSearch.deleteConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
