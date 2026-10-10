import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from 'radix-ui';
import { Rows3 } from 'lucide-react';
import { FADE_CURVES, type FadeCurve } from '@shared/types';
import { useAppStore } from '../../store';
import { NumberField } from '../ui/NumberField';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';

/** Concatenate ("ghép") all tracks in list order with a gap and/or crossfade. */
export function ArrangePopover({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const arrange = useAppStore((s) => s.arrangeSequential);
  const [open, setOpen] = useState(false);
  const [gapMs, setGapMs] = useState(0);
  const [crossfadeMs, setCrossfadeMs] = useState(0);
  const [curve, setCurve] = useState<FadeCurve>('equalPower');

  const apply = (): void => {
    arrange(gapMs / 1000, crossfadeMs / 1000, curve);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled} icon={<Rows3 className="size-4" />} title={t('app.toolbar.arrangeHint')}>
          {t('app.toolbar.arrange')}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-72 rounded-lg border border-border bg-surface p-3 text-fg shadow-[var(--shadow-pop)]"
        >
          <h3 className="mb-1 text-xs font-semibold">{t('app.arrange.title')}</h3>
          <p className="mb-3 text-[11px] text-fg-subtle">{t('app.arrange.description')}</p>
          <div className="flex flex-col gap-2.5 text-xs">
            <label className="flex items-center justify-between gap-3">
              <span>{t('app.arrange.gap')}</span>
              <NumberField aria-label={t('app.arrange.gap')} value={gapMs} onChange={setGapMs} min={0} max={60000} step={10} unit={t('app.units.ms')} className="w-28" />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>{t('app.arrange.crossfade')}</span>
              <NumberField
                aria-label={t('app.arrange.crossfade')}
                value={crossfadeMs}
                onChange={setCrossfadeMs}
                min={0}
                max={30000}
                step={10}
                unit={t('app.units.ms')}
                className="w-28"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>{t('app.arrange.curve')}</span>
              <Select<FadeCurve>
                value={curve}
                onValueChange={setCurve}
                options={FADE_CURVES.map((c) => ({ value: c, label: t(`app.curves.${c}`) }))}
                size="sm"
                className="w-36"
              />
            </label>
            <Button variant="primary" size="sm" onClick={apply} className="mt-1">
              {t('app.arrange.apply')}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
