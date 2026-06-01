import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/i18n';
import type { CreateExchangeTokenResponse } from './options';

interface TokenResultDialogProps {
  open: boolean;
  result: CreateExchangeTokenResponse | null;
  onOpenChange: (open: boolean) => void;
}

const TokenResultDialog = ({
  open,
  result,
  onOpenChange,
}: TokenResultDialogProps) => {
  const t = useT();

  const copyToClipboard = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
  }, []);

  const exchangeUrl = result
    ? new URL(result.exchangeUrl, window.location.origin).toString()
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>
            {t('ApiKeyMgmt.dialog.tokenResult', '兑换令牌已生成')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'ApiKeyMgmt.dialog.tokenResultDesc',
              '请妥善保存以下信息，令牌仅显示一次',
            )}
          </DialogDescription>
        </DialogHeader>

        {result && (
          <div className="flex flex-col gap-4 py-4">
            <p className="text-sm font-medium text-destructive">
              {t(
                'ApiKeyMgmt.warning.token',
                '此链接仅可使用 {{count}} 次，请通过安全渠道发送给接入方',
                { count: result.maxUsage },
              )}
            </p>

            <div className="grid gap-2">
              <span className="text-sm text-muted-foreground">
                {t('ApiKeyMgmt.field.exchangeUrl', '兑换链接')}
              </span>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-muted p-3 text-sm">
                  {exchangeUrl}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(exchangeUrl)}
                >
                  {t('ApiKeyMgmt.action.copy', '复制')}
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <span className="text-sm text-muted-foreground">
                {t('ApiKeyMgmt.field.exchangeToken', '兑换令牌')}
              </span>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-muted p-3 font-mono text-sm">
                  {result.exchangeToken}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(result.exchangeToken)}
                >
                  {t('ApiKeyMgmt.action.copy', '复制')}
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <span className="text-sm text-muted-foreground">
                {t('ApiKeyMgmt.column.keyPrefix', 'Key 前缀')}
              </span>
              <span className="font-mono text-sm">{result.tokenPrefix}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            {t('ApiKeyMgmt.dialog.close', '关闭')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export type { TokenResultDialogProps };
export { TokenResultDialog };
