import { useTranslation } from 'react-i18next';
import { Popover } from 'radix-ui';
import { Settings2 } from 'lucide-react';
import { useAppStore } from '../../store';
import { NumberField } from '../ui/NumberField';
import { Switch } from '../ui/Switch';
import { Select } from '../ui/Select';
import type { ColormapName } from '../../utils/colormap';

export function SettingsPopover() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const setSleepMinutes = useAppStore((s) => s.setSleepMinutes);
  const setSnap = useAppStore((s) => s.setSnap);
  const setColormap = useAppStore((s) => s.setColormap);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t('app.settings.title')}
          title={t('app.settings.title')}
          className="no-drag flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
        >
          <Settings2 className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-72 rounded-lg border border-border bg-surface p-3 text-fg shadow-[var(--shadow-pop)]"
        >
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">{t('app.settings.title')}</h3>
          <div className="flex flex-col gap-3">
            <label className="flex items-center justify-between gap-3 text-xs">
              <span>{t('app.settings.sleepMinutes')}</span>
              <NumberField
                aria-label={t('app.settings.sleepMinutes')}
                value={settings.sleepMinutes}
                onChange={setSleepMinutes}
                min={1}
                max={240}
                step={1}
                unit={t('app.units.min')}
                className="w-24"
              />
            </label>
            <p className="-mt-2 text-[11px] text-fg-subtle">{t('app.settings.sleepHint')}</p>
            <Switch checked={settings.snap} onCheckedChange={setSnap} label={t('app.settings.snap')} />
            <label className="flex items-center justify-between gap-3 text-xs">
              <span>{t('app.settings.colormap')}</span>
              <Select<ColormapName>
                value={settings.colormap}
                onValueChange={setColormap}
                options={[
                  { value: 'magma', label: t('app.settings.colormapMagma') },
                  { value: 'inferno', label: t('app.settings.colormapInferno') },
                ]}
                size="sm"
                className="w-28"
              />
            </label>
          </div>
          <Popover.Arrow className="fill-[var(--color-border)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
