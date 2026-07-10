/**
 * 客户详情页 - /customers/[id]
 *
 * 后端：GET /admin/users/:id（W7-feature）
 *   - 含 profile + stats（orderCount/totalSpent）+ 最近 5 订单 + 全部地址
 *
 * 动作：
 *   - Suspend / Activate（status 切换）
 *   - Reset Password（生成 12 字符临时密码，明文一次性返回）
 *   - Edit（name/phone/email/role/verified）
 */
'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  useCustomerDetail,
  useSuspendCustomer,
  useActivateCustomer,
  useResetPassword,
  useUpdateCustomer,
  type UserRole,
} from '@/hooks/api/use-customers';
import { formatCurrency } from '@/lib/utils';

const ROLE_OPTIONS: { value: UserRole; labelKey: string }[] = [
  { value: 'super_admin', labelKey: 'admin.customers.roleSuperAdmin' },
  { value: 'customer', labelKey: 'admin.customers.roleCustomer' },
  { value: 'rider', labelKey: 'admin.customers.roleRider' },
  { value: 'warehouse_staff', labelKey: 'admin.customers.roleWarehouseStaff' },
  { value: 'customer_service', labelKey: 'admin.customers.roleCustomerService' },
];

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();

  const { data: customer, isLoading, error, refetch } = useCustomerDetail(id);
  const suspendMutation = useSuspendCustomer();
  const activateMutation = useActivateCustomer();
  const resetMutation = useResetPassword();
  const updateMutation = useUpdateCustomer();

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [activateOpen, setActivateOpen] = useState(false);
  const [activateReason, setActivateReason] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string;
    phone: string;
    email: string;
    role: UserRole;
    phoneVerified: boolean;
    emailVerified: boolean;
  }>({
    name: '',
    phone: '',
    email: '',
    role: 'customer',
    phoneVerified: false,
    emailVerified: false,
  });

  function openEditDialog() {
    if (!customer) return;
    setEditForm({
      name: customer.name ?? '',
      phone: customer.phone,
      email: customer.email ?? '',
      role: customer.role,
      phoneVerified: customer.phoneVerified,
      emailVerified: customer.emailVerified,
    });
    setEditOpen(true);
  }

  function handleSuspend() {
    suspendMutation.mutate(
      { id, reason: suspendReason || undefined },
      {
        onSuccess: () => {
          setSuspendOpen(false);
          setSuspendReason('');
          toast({ title: t('admin.customers.toastSuspended') });
        },
        onError: (err: Error) => {
          toast({
            title: t('admin.customers.toastFailed'),
            description: err.message,
            variant: 'destructive',
          });
        },
      },
    );
  }

  function handleActivate() {
    activateMutation.mutate(
      { id, reason: activateReason || undefined },
      {
        onSuccess: () => {
          setActivateOpen(false);
          setActivateReason('');
          toast({ title: t('admin.customers.toastActivated') });
        },
        onError: (err: Error) => {
          toast({
            title: t('admin.customers.toastFailed'),
            description: err.message,
            variant: 'destructive',
          });
        },
      },
    );
  }

  function handleResetPassword() {
    resetMutation.mutate(id, {
      onSuccess: (data) => {
        setTempPassword(data.temporaryPassword);
        setCopied(false);
      },
      onError: (err: Error) => {
        toast({
          title: t('admin.customers.toastFailed'),
          description: err.message,
          variant: 'destructive',
        });
      },
    });
  }

  function closeResetDialog() {
    setResetOpen(false);
    setTempPassword(null);
    setCopied(false);
  }

  function copyTempPassword() {
    if (!tempPassword) return;
    navigator.clipboard.writeText(tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSaveEdit() {
    updateMutation.mutate(
      {
        id,
        input: {
          name: editForm.name,
          phone: editForm.phone,
          email: editForm.email === '' ? null : editForm.email,
          role: editForm.role,
          phoneVerified: editForm.phoneVerified,
          emailVerified: editForm.emailVerified,
        },
      },
      {
        onSuccess: () => {
          setEditOpen(false);
          toast({ title: t('admin.customers.toastUpdated') });
        },
        onError: (err: Error) => {
          toast({
            title: t('admin.customers.toastFailed'),
            description: err.message,
            variant: 'destructive',
          });
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 text-center text-muted-foreground">{t('loading')}</div>
    );
  }

  if (error || !customer) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={`#${id.slice(0, 8)}`} />
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  const isSuspended = customer.status === 'SUSPENDED';
  const isDeleted = customer.status === 'DELETED';

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={customer.name || customer.phone}
        description={`${t('admin.customers.columnCreatedAt')}: ${new Date(customer.createdAt).toLocaleString()}`}
        action={
          !isDeleted && (
            <div className="flex items-center gap-2">
              {isSuspended ? (
                <Button variant="default" onClick={() => setActivateOpen(true)}>
                  {t('admin.customers.activateButton')}
                </Button>
              ) : (
                <Button variant="warning" onClick={() => setSuspendOpen(true)}>
                  {t('admin.customers.suspendButton')}
                </Button>
              )}
              <Button variant="outline" onClick={() => setResetOpen(true)}>
                {t('admin.customers.resetPasswordButton')}
              </Button>
              <Button variant="outline" onClick={openEditDialog}>
                {t('admin.customers.editButton')}
              </Button>
            </div>
          )
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.customers.statsOrderCount')}</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="font-mono text-2xl font-bold">{customer.orderCount}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.customers.statsTotalSpent')}</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="font-mono text-lg font-bold">
              {formatCurrency(customer.totalSpent)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.customers.statsLastLoginAt')}</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-xs text-muted-foreground">
              {customer.lastLoginAt ? new Date(customer.lastLoginAt).toLocaleString() : '-'}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.customers.statsCreatedAt')}</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-xs text-muted-foreground">
              {new Date(customer.createdAt).toLocaleString()}
            </span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.customers.sectionProfile')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t('admin.customers.columnPhone')}</dt>
                <dd className="font-mono">{customer.phone}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('admin.customers.columnName')}</dt>
                <dd>{customer.name ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('admin.customers.formEmail')}</dt>
                <dd className="font-mono text-xs">{customer.email ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('admin.customers.columnRole')}</dt>
                <dd>
                  <Badge variant="outline">
                    {t(`admin.customers.role${customer.role.charAt(0).toUpperCase()}${customer.role.slice(1).replace(/_./g, (m) => m[1].toUpperCase())}`)}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('admin.customers.columnStatus')}</dt>
                <dd><StatusBadge status={customer.status} /></dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('admin.customers.badgeVerified')}</dt>
                <dd className="flex flex-wrap gap-1">
                  {customer.phoneVerified && (
                    <Badge variant="success">{t('admin.customers.badgePhoneVerified')}</Badge>
                  )}
                  {customer.emailVerified && (
                    <Badge variant="success">{t('admin.customers.badgeEmailVerified')}</Badge>
                  )}
                  {!customer.phoneVerified && !customer.emailVerified && (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin.customers.sectionOrders')}</CardTitle>
          </CardHeader>
          <CardContent>
            {customer.recentOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('admin.customers.emptyOrders')}</p>
            ) : (
              <div className="space-y-2">
                {customer.recentOrders.map((order) => (
                  <button
                    key={order.id}
                    onClick={() => router.push(`/orders/${order.id}`)}
                    className="flex w-full items-center justify-between rounded border p-2 text-left text-sm hover:bg-accent"
                  >
                    <div className="space-y-1">
                      <p className="font-mono text-xs">{order.orderNo}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={order.status} />
                      <span className="font-mono text-xs">
                        {formatCurrency(order.payableAmount)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.customers.sectionAddresses')}</CardTitle>
        </CardHeader>
        <CardContent>
          {customer.addresses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin.customers.emptyAddresses')}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {customer.addresses.map((addr) => (
                <div
                  key={addr.id}
                  className={`rounded border p-3 ${addr.isDefault ? 'border-primary' : ''}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium">{addr.name}</span>
                    {addr.isDefault && (
                      <Badge variant="info">{t('admin.customers.addressDefault')}</Badge>
                    )}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{addr.phone}</p>
                  <p className="mt-1 text-xs">
                    {addr.region.province} {addr.region.city}
                    {addr.region.district ? ` ${addr.region.district}` : ''}
                  </p>
                  <p className="text-xs">{addr.detail}</p>
                  {addr.tag && (
                    <Badge variant="outline" className="mt-1">
                      {addr.tag}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Suspend Dialog */}
      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.customers.suspendDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.customers.suspendDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="suspend-reason">{t('admin.customers.suspendDialogReasonLabel')}</Label>
            <Textarea
              id="suspend-reason"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder={t('admin.customers.suspendDialogReasonPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendOpen(false)}>
              {t('admin.customers.commonCancel')}
            </Button>
            <Button
              variant="warning"
              onClick={handleSuspend}
              disabled={suspendMutation.isPending}
            >
              {suspendMutation.isPending ? t('admin.customers.submitting') : t('admin.customers.suspendDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate Dialog */}
      <Dialog open={activateOpen} onOpenChange={setActivateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.customers.activateDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.customers.activateDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="activate-reason">{t('admin.customers.activateDialogReasonLabel')}</Label>
            <Textarea
              id="activate-reason"
              value={activateReason}
              onChange={(e) => setActivateReason(e.target.value)}
              placeholder={t('admin.customers.activateDialogReasonPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivateOpen(false)}>
              {t('admin.customers.commonCancel')}
            </Button>
            <Button
              variant="default"
              onClick={handleActivate}
              disabled={activateMutation.isPending}
            >
              {activateMutation.isPending ? t('admin.customers.submitting') : t('admin.customers.activateDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetOpen} onOpenChange={(open) => (open ? setResetOpen(true) : closeResetDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.customers.resetDialogTitle')}</DialogTitle>
            <DialogDescription>
              {tempPassword ? t('admin.customers.resetDialogDescriptionDone') : t('admin.customers.resetDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          {tempPassword ? (
            <div className="space-y-3">
              <div className="rounded border-2 border-yellow-500/40 bg-yellow-100 p-3">
                <div className="flex items-center gap-2 text-yellow-700">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-xs font-medium">{t('admin.customers.resetDialogWarning')}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('admin.customers.resetDialogTemporaryPasswordLabel')}</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted p-2 font-mono text-lg tracking-wider">
                    {tempPassword}
                  </code>
                  <Button variant="outline" size="icon" onClick={copyTempPassword}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('admin.customers.resetDialogConfirmHint')}
            </p>
          )}
          <DialogFooter>
            {tempPassword ? (
              <Button variant="default" onClick={closeResetDialog}>
                {t('admin.customers.resetDialogClose')}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeResetDialog}>
                  {t('admin.customers.commonCancel')}
                </Button>
                <Button
                  variant="default"
                  onClick={handleResetPassword}
                  disabled={resetMutation.isPending}
                >
                  {resetMutation.isPending ? t('admin.customers.submitting') : t('admin.customers.resetDialogConfirm')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.customers.editDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.customers.editDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="edit-name">{t('admin.customers.formName')}</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">{t('admin.customers.formPhone')}</Label>
              <Input
                id="edit-phone"
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">{t('admin.customers.formEmail')}</Label>
              <Input
                id="edit-email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.customers.formRole')}</Label>
              <Select
                value={editForm.role}
                onValueChange={(v) => setEditForm({ ...editForm, role: v as UserRole })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-phone-verified">{t('admin.customers.formPhoneVerified')}</Label>
              <Switch
                id="edit-phone-verified"
                checked={editForm.phoneVerified}
                onCheckedChange={(checked) => setEditForm({ ...editForm, phoneVerified: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-email-verified">{t('admin.customers.formEmailVerified')}</Label>
              <Switch
                id="edit-email-verified"
                checked={editForm.emailVerified}
                onCheckedChange={(checked) => setEditForm({ ...editForm, emailVerified: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {t('admin.customers.commonCancel')}
            </Button>
            <Button
              variant="default"
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? t('admin.customers.submitting') : t('admin.customers.editDialogSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
