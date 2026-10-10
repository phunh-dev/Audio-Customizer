import { useTranslation } from 'react-i18next';
import { FilePlus2, FolderOpen, Moon, Redo2, Scissors, SquareSplitHorizontal, Sun, Trash2, Undo2 } from 'lucide-react';
import { useAppStore, useActiveTab, useCanRedo, useCanUndo } from '../../store';
import { Button, IconButton } from '../ui/Button';
import { LanguageSwitch } from './LanguageSwitch';
import { SettingsPopover } from './SettingsPopover';
import { ArrangePopover } from './ArrangePopover';
import { ExportDialog } from '../../features/export/ExportDialog';
import { isMac } from './TitleBar';

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
}

export function Toolbar() {
  const { t } = useTranslation();
  const mod = isMac() ? '⌘' : 'Ctrl+';
  const s = useAppStore.getState;
  const tab = useActiveTab();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const theme = useAppStore((st) => st.settings.theme);
  const importing = useAppStore((st) => st.importing);
  const hasTracks = tab.project.tracks.length > 0;
  const hasSelection = tab.selection !== null;

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
      <Button
        variant="primary"
        size="sm"
        disabled={importing}
        icon={<FilePlus2 className="size-4" />}
        onClick={() => void s().openFilesDialog()}
      >
        {t('app.toolbar.openFiles')}
      </Button>
      <Button size="sm" variant="ghost" disabled={importing} icon={<FolderOpen className="size-4" />} onClick={() => void s().openFolderDialog()}>
        {t('app.toolbar.openFolder')}
      </Button>
      <Divider />
      <IconButton label={`${t('app.toolbar.undo')} (${mod}Z)`} icon={<Undo2 className="size-4" />} disabled={!canUndo} onClick={() => s().undo()} />
      <IconButton label={`${t('app.toolbar.redo')} (${mod}Y)`} icon={<Redo2 className="size-4" />} disabled={!canRedo} onClick={() => s().redo()} />
      <Divider />
      <IconButton
        label={`${t('app.toolbar.split')} (S)`}
        icon={<SquareSplitHorizontal className="size-4" />}
        disabled={!hasTracks}
        onClick={() => s().splitAtPlayhead()}
      />
      <IconButton
        label={t('app.toolbar.trim')}
        icon={<Scissors className="size-4" />}
        disabled={!hasTracks || !hasSelection}
        onClick={() => s().trimToSelection()}
      />
      <IconButton
        label={`${t('app.toolbar.deleteRegion')} (Del)`}
        icon={<Trash2 className="size-4" />}
        disabled={!hasTracks || !hasSelection}
        onClick={() => s().deleteSelection()}
      />
      <ArrangePopover disabled={tab.project.tracks.length < 2} />
      <div className="flex-1" />
      <LanguageSwitch />
      <IconButton
        label={theme === 'dark' ? t('app.toolbar.lightTheme') : t('app.toolbar.darkTheme')}
        icon={theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        onClick={() => s().setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
      <SettingsPopover />
      <Divider />
      <ExportDialog />
    </div>
  );
}
