import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Moon, Plus, X } from 'lucide-react';
import { useAppStore, type Tab } from '../../store';
import { cn } from '../ui/cn';

export function tabLabel(tab: Pick<Tab, 'title' | 'number'>, t: (k: string, o?: Record<string, unknown>) => string): string {
  return tab.title ?? t('app.tabs.defaultName', { n: tab.number });
}

interface TabItemProps {
  tab: Tab;
  active: boolean;
}

function TabItem({ tab, active }: TabItemProps) {
  const { t } = useTranslation();
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const renameTab = useAppStore((s) => s.renameTab);
  const [editing, setEditing] = useState(false);
  const label = tabLabel(tab, t);
  const [draft, setDraft] = useState(label);

  const commit = (): void => {
    renameTab(tab.id, draft);
    setEditing(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') setEditing(false);
  };

  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid={`tab-${tab.id}`}
      title={tab.sleeping ? t('app.tabs.sleepingHint') : label}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          void closeTab(tab.id);
        }
      }}
      onClick={() => void setActiveTab(tab.id)}
      onDoubleClick={() => {
        setDraft(label);
        setEditing(true);
      }}
      className={cn(
        'no-drag group relative flex h-8 min-w-[120px] max-w-[220px] cursor-default items-center gap-2 rounded-t-lg pl-3 pr-1.5 text-xs transition-colors',
        // the title bar is dark in both themes: inactive tabs use white-based colours,
        // the active tab takes the toolbar surface so it connects with it
        active
          ? 'bg-surface font-medium text-fg'
          : 'bg-transparent text-white/55 hover:bg-white/[0.07] hover:text-white/90',
      )}
    >
      {active && <span aria-hidden className="absolute inset-x-3 top-0 h-0.5 rounded-b bg-linear-to-r from-cyan via-accent to-pink" />}
      {tab.loading ? (
        <Loader2 aria-label={t('app.tabs.loading')} className="size-3.5 shrink-0 animate-ac-spin text-accent" />
      ) : tab.sleeping ? (
        <Moon aria-label={t('app.tabs.sleeping')} className={cn('size-3.5 shrink-0', active ? 'text-fg-subtle' : 'text-white/45')} />
      ) : null}
      {editing ? (
        <input
          autoFocus
          aria-label={t('app.tabs.rename')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          onClick={(e) => e.stopPropagation()}
          className="h-6 min-w-0 flex-1 rounded bg-surface-3 px-1.5 text-xs text-fg outline-none ring-1 ring-accent"
        />
      ) : (
        <span className={cn('min-w-0 flex-1 truncate', tab.sleeping && 'italic')}>{label}</span>
      )}
      <button
        type="button"
        aria-label={t('app.tabs.close', { name: label })}
        onClick={(e) => {
          e.stopPropagation();
          void closeTab(tab.id);
        }}
        className={cn(
          'focus-ring flex size-5 shrink-0 items-center justify-center rounded transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
          active
            ? 'text-fg-subtle opacity-80 hover:bg-surface-3 hover:text-fg'
            : 'text-white/60 opacity-50 hover:bg-white/10 hover:text-white',
        )}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const newTab = useAppStore((s) => s.newTab);
  return (
    <div role="tablist" aria-label={t('app.tabs.label')} className="scroll-none flex min-w-0 items-end gap-0.5 overflow-x-auto">
      {tabs.map((tab) => (
        <TabItem key={tab.id} tab={tab} active={tab.id === activeTabId} />
      ))}
      <button
        type="button"
        aria-label={t('app.tabs.new')}
        title={t('app.tabs.new')}
        onClick={() => newTab()}
        className="focus-ring no-drag mb-1 ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
