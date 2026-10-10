import { useTranslation } from 'react-i18next';
import { FilePlus2, Headphones, Volume2, VolumeX, X } from 'lucide-react';
import type { SourceInfo } from '@shared/api';
import type { Track } from '@shared/types';
import { useAppStore, useActiveTab } from '../../store';
import { formatDuration } from '../../utils/time';
import { formatBytes } from '../../utils/format';
import { cn } from '../ui/cn';

interface TrackItemProps {
  track: Track;
  source: SourceInfo | undefined;
  selected: boolean;
  index: number;
}

export function TrackItem({ track, source, selected, index }: TrackItemProps) {
  const { t } = useTranslation();
  const selectTrack = useAppStore((s) => s.selectTrack);
  const removeTrack = useAppStore((s) => s.removeTrack);
  const updateTrack = useAppStore((s) => s.updateTrack);
  const channels = source
    ? source.channels === 1
      ? t('tracks.mono')
      : source.channels === 2
        ? t('tracks.stereo')
        : t('tracks.channels', { count: source.channels })
    : '';
  return (
    <li
      data-testid="track-item"
      aria-selected={selected}
      onClick={() => selectTrack(selected ? null : track.id)}
      className={cn(
        'group relative flex cursor-default flex-col gap-1 rounded-lg border px-2.5 py-2 transition-colors',
        selected ? 'border-accent bg-accent-soft' : 'border-transparent bg-surface-2 hover:border-border',
        track.mute && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-1">
        <span className="mr-1 flex size-5 shrink-0 items-center justify-center rounded bg-surface-3 font-mono text-[10px] text-fg-muted">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg" title={source?.path ?? track.name}>
          {track.name}
        </span>
        <button
          type="button"
          aria-label={track.mute ? t('tracks.unmute') : t('tracks.mute')}
          aria-pressed={track.mute}
          title={t('tracks.mute')}
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { mute: !track.mute });
          }}
          className={cn(
            'focus-ring flex size-[22px] items-center justify-center rounded text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg',
            track.mute && 'text-danger',
          )}
        >
          {track.mute ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
        </button>
        <button
          type="button"
          aria-label={t('tracks.solo')}
          aria-pressed={track.solo}
          title={t('tracks.solo')}
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { solo: !track.solo });
          }}
          className={cn(
            'focus-ring flex size-[22px] items-center justify-center rounded text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg',
            track.solo && 'bg-warning/20 text-warning',
          )}
        >
          <Headphones className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={t('tracks.remove', { name: track.name })}
          title={t('tracks.removeHint')}
          onClick={(e) => {
            e.stopPropagation();
            removeTrack(track.id);
          }}
          className="focus-ring flex size-[22px] items-center justify-center rounded text-fg-subtle transition-colors hover:bg-danger/20 hover:text-danger"
        >
          <X className="size-4" />
        </button>
      </div>
      {source && (
        <dl className="ml-6 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[10.5px] text-fg-subtle">
          <dt className="sr-only">{t('tracks.format')}</dt>
          <dd className="uppercase text-fg-muted">{source.format}</dd>
          <dt className="sr-only">{t('tracks.sampleRate')}</dt>
          <dd>{t('tracks.hz', { value: source.sampleRate })}</dd>
          <dt className="sr-only">{t('tracks.channelsLabel')}</dt>
          <dd>{channels}</dd>
          <dt className="sr-only">{t('tracks.duration')}</dt>
          <dd>{formatDuration(source.duration)}</dd>
          <dt className="sr-only">{t('tracks.size')}</dt>
          <dd>{formatBytes(source.fileSize)}</dd>
          {source.bitDepth ? (
            <>
              <dt className="sr-only">{t('tracks.bitDepth')}</dt>
              <dd>{t('tracks.bits', { value: source.bitDepth })}</dd>
            </>
          ) : null}
        </dl>
      )}
    </li>
  );
}

export function TrackList() {
  const { t } = useTranslation();
  const tab = useActiveTab();
  const sources = useAppStore((s) => s.sources);
  const tracks = tab.project.tracks;
  return (
    <section aria-label={t('tracks.title')} className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          {t('tracks.title')}
          <span className="ml-1.5 rounded bg-surface-3 px-1.5 py-px font-mono text-[10px] text-fg-subtle">{tracks.length}</span>
        </h2>
        <button
          type="button"
          aria-label={t('app.toolbar.openFiles')}
          title={t('app.toolbar.openFiles')}
          onClick={() => void useAppStore.getState().openFilesDialog()}
          className="flex size-6 items-center justify-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg"
        >
          <FilePlus2 className="size-3.5" />
        </button>
      </div>
      {tracks.length === 0 ? (
        <p className="p-4 text-center text-xs text-fg-subtle">{t('tracks.empty')}</p>
      ) : (
        <ul data-testid="track-list" className="scroll-thin flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {tracks.map((tr, i) => (
            <TrackItem key={tr.id} track={tr} index={i} source={sources[tr.sourceId]} selected={tr.id === tab.selectedTrackId} />
          ))}
        </ul>
      )}
    </section>
  );
}
