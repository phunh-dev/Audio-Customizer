//! Engine facade integration tests: sources, sessions, render, export,
//! estimate, release, transport (with a fake output device).

use audio_core::analysis::tone_amplitude;
use audio_core::decode::decode_file;
use audio_core::encode::{export_bytes, ChannelMode, ExportFormat, ExportOptions};
use audio_core::engine::{normalize_path, Engine};
use audio_core::playback::{OutputHandle, PlayState, Transport};
use audio_core::project::{Project, Track};
use audio_core::render::RenderSizes;
use audio_core::signals;
use audio_core::{AudioBuffer, AudioError};
use parking_lot::Mutex;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

struct FakeOutput {
    rate: u32,
}

impl OutputHandle for FakeOutput {
    fn sample_rate(&self) -> u32 {
        self.rate
    }
    fn channels(&self) -> usize {
        2
    }
}

fn fake_engine(rate: u32) -> (Engine, Arc<AtomicUsize>) {
    let opened = Arc::new(AtomicUsize::new(0));
    let o = opened.clone();
    let engine = Engine::with_output_factory(Box::new(move |_t: Arc<Mutex<Transport>>| {
        o.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeOutput { rate }) as Box<dyn OutputHandle>)
    }));
    (engine, opened)
}

fn no_device_engine() -> Engine {
    Engine::with_output_factory(Box::new(|_t| Err(AudioError::NoAudioDevice("none".into()))))
}

fn sizes() -> RenderSizes {
    RenderSizes { peaks_buckets: 50, spectrogram_width: 16, spectrogram_height: 8 }
}

fn write_wav(dir: &Path, name: &str, buf: &AudioBuffer) -> String {
    let path = dir.join(name);
    std::fs::write(&path, export_bytes(buf, &ExportOptions { bit_depth: 32, ..Default::default() }).unwrap()).unwrap();
    path.to_string_lossy().into_owned()
}

fn project_for(ids: &[&str]) -> Project {
    let mut p = Project::default();
    for (i, id) in ids.iter().enumerate() {
        p.tracks.push(Track::new(format!("t{i}"), *id));
    }
    p
}

#[test]
fn load_source_reports_details_and_normalized_id() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_wav(dir.path(), "Tone.WAV", &signals::sine(440.0, 22_050, 0.5, 0.5));
    let engine = Engine::new();
    let dotted = format!("{}/./Tone.WAV", dir.path().display());
    let info = engine.load_source(&dotted).unwrap();
    assert_eq!(info.id, normalize_path(&path).unwrap());
    assert_eq!(info.path, info.id);
    assert_eq!(info.name, "Tone.WAV");
    assert_eq!(info.format, "wav");
    assert_eq!(info.sample_rate, 22_050);
    assert_eq!(info.channels, 1);
    assert_eq!(info.frames, 11_025);
    assert!((info.duration - 0.5).abs() < 1e-6);
    assert!(info.file_size > 0);
    let json = serde_json::to_value(&info).unwrap();
    for k in ["id", "path", "name", "format", "sampleRate", "channels", "frames", "duration", "bitDepth", "fileSize"] {
        assert!(json.get(k).is_some(), "{k}");
    }
    assert_eq!(engine.source_count(), 1);
    assert_eq!(engine.source_details(&info.id).unwrap(), info);
    let peaks = engine.source_peaks(&info.id, 10).unwrap();
    assert_eq!(peaks.len(), 20);
    assert!(peaks[1] > 0.45);
    // Loading again replaces, not duplicates.
    engine.load_source(&path).unwrap();
    assert_eq!(engine.source_count(), 1);
    engine.unload_source(&info.id);
    assert_eq!(engine.source_count(), 0);
    engine.unload_source("never-loaded");
}

#[test]
fn source_errors_have_codes() {
    let engine = Engine::new();
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing.wav");
    assert_eq!(engine.load_source(&missing.to_string_lossy()).unwrap_err().code(), "ERR_FILE_NOT_FOUND");
    let txt = dir.path().join("a.txt");
    std::fs::write(&txt, "hi").unwrap();
    assert_eq!(engine.load_source(&txt.to_string_lossy()).unwrap_err().code(), "ERR_UNSUPPORTED_FORMAT");
    let bad = dir.path().join("bad.wav");
    std::fs::write(&bad, b"definitely not a wav file at all").unwrap();
    let code = engine.load_source(&bad.to_string_lossy()).unwrap_err().code();
    assert!(code == "ERR_DECODE_FAILED" || code == "ERR_UNSUPPORTED_FORMAT", "{code}");
    assert_eq!(engine.source_peaks("x", 10).unwrap_err().code(), "ERR_SOURCE_NOT_LOADED");
    assert_eq!(engine.source_details("x").unwrap_err().code(), "ERR_SOURCE_NOT_LOADED");
    assert_eq!(engine.session_stats("nope").unwrap_err().code(), "ERR_SESSION_NOT_FOUND");
    assert_eq!(engine.render("s", &Project::default(), None, sizes()).unwrap_err().code(), "ERR_EMPTY_PROJECT");
    assert_eq!(
        engine.render("s", &project_for(&["ghost"]), None, sizes()).unwrap_err().code(),
        "ERR_SOURCE_NOT_LOADED"
    );
}

#[test]
fn render_from_files_mixes_and_caches() {
    let dir = tempfile::tempdir().unwrap();
    let a = write_wav(dir.path(), "a.wav", &signals::sine(500.0, 44_100, 1.0, 0.3));
    let b = write_wav(dir.path(), "b.wav", &signals::sine(2000.0, 22_050, 1.0, 0.3));
    let engine = Engine::new();
    let ia = engine.load_source(&a).unwrap();
    let ib = engine.load_source(&b).unwrap();
    let mut p = project_for(&[&ia.id, &ib.id]);
    let out = engine.render("tab1", &p, None, sizes()).unwrap();
    assert_eq!(out.analysis.sample_rate, 44_100);
    assert!((tone_amplitude(&out.buffer, 500.0) - 0.3).abs() < 0.02);
    assert!((tone_amplitude(&out.buffer, 2000.0) - 0.3).abs() < 0.02);
    let again = engine.render("tab1", &p, None, sizes()).unwrap();
    assert!(Arc::ptr_eq(&out.buffer, &again.buffer));
    let stats = engine.session_stats("tab1").unwrap();
    assert_eq!(stats.get("mix"), Some(&1));
    assert_eq!(stats.get("resample"), Some(&1));
    // A master change does not resample or remix.
    p.master.effects.volume.gain_db = -6.0;
    engine.render("tab1", &p, None, sizes()).unwrap();
    let stats = engine.session_stats("tab1").unwrap();
    assert_eq!(stats.get("mix"), Some(&1));
    assert_eq!(stats.get("resample"), Some(&1));
    assert_eq!(stats.get("volume"), Some(&1));
    // Sessions are independent.
    engine.render("tab2", &p, None, sizes()).unwrap();
    assert_eq!(engine.session_count(), 2);
    assert_eq!(engine.session_stats("tab2").unwrap().get("mix"), Some(&1));
}

#[test]
fn export_writes_only_at_given_path_with_requested_format() {
    let dir = tempfile::tempdir().unwrap();
    let src_dir = dir.path().join("src");
    let out_dir = dir.path().join("out");
    std::fs::create_dir_all(&src_dir).unwrap();
    std::fs::create_dir_all(&out_dir).unwrap();
    let a = write_wav(&src_dir, "a.wav", &AudioBuffer::from_channels(
        48_000,
        vec![signals::sine(440.0, 48_000, 0.5, 0.5).channels[0].clone(); 2],
    ));
    let engine = Engine::new();
    let id = engine.load_source(&a).unwrap().id;
    let p = project_for(&[&id]);
    let cases = [
        (ExportFormat::Wav, 22_050, ChannelMode::Mono, 1usize),
        (ExportFormat::Flac, 44_100, ChannelMode::Stereo, 2),
        (ExportFormat::Mp3, 32_000, ChannelMode::Mono, 1),
        (ExportFormat::Ogg, 0, ChannelMode::Source, 2),
        (ExportFormat::Aiff, 16_000, ChannelMode::Stereo, 2),
    ];
    let src_before: Vec<_> = std::fs::read_dir(&src_dir).unwrap().map(|e| e.unwrap().file_name()).collect();
    for (i, (format, rate, channels, expect_ch)) in cases.into_iter().enumerate() {
        let opts = ExportOptions { format, sample_rate: rate, channels, bitrate_kbps: 128, ..Default::default() };
        let estimate = engine.estimate_size("s", &p, &opts).unwrap();
        let path = out_dir.join(format!("out{i}.{}", format.extension()));
        let written = engine.export("s", &p, &opts, &path.to_string_lossy()).unwrap();
        let on_disk = std::fs::metadata(&path).unwrap().len();
        assert_eq!(written, on_disk, "{format:?}");
        assert_eq!(estimate, on_disk, "estimate must be exact for {format:?}");
        let decoded = decode_file(&path).unwrap();
        let expect_rate = if rate == 0 { 48_000 } else { rate };
        assert_eq!(decoded.info.sample_rate, expect_rate, "{format:?}");
        assert_eq!(decoded.buffer.num_channels(), expect_ch, "{format:?}");
        assert!((decoded.info.duration - 0.5).abs() < 0.06, "{format:?} {}", decoded.info.duration);
    }
    let out_files = std::fs::read_dir(&out_dir).unwrap().count();
    assert_eq!(out_files, 5, "exactly one file per export");
    let src_after: Vec<_> = std::fs::read_dir(&src_dir).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(src_before, src_after, "nothing written next to the source");
}

#[test]
fn export_errors() {
    let engine = Engine::new();
    engine.insert_source("a", signals::sine(440.0, 44_100, 0.1, 0.5));
    let p = project_for(&["a"]);
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(engine.export("s", &p, &ExportOptions::default(), "").unwrap_err().code(), "ERR_INVALID_PARAM");
    let bad_dir = dir.path().join("no/such/dir/x.wav");
    assert_eq!(
        engine.export("s", &p, &ExportOptions::default(), &bad_dir.to_string_lossy()).unwrap_err().code(),
        "ERR_IO"
    );
    let bad_opts = ExportOptions { format: ExportFormat::Mp3, sample_rate: 96_000, ..Default::default() };
    let target = dir.path().join("x.mp3");
    assert_eq!(engine.export("s", &p, &bad_opts, &target.to_string_lossy()).unwrap_err().code(), "ERR_INVALID_PARAM");
    assert!(!target.exists(), "nothing written on error");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn preview_render_matches_export_settings() {
    let engine = Engine::new();
    engine.insert_source("a", signals::sine(440.0, 48_000, 0.5, 0.5));
    let p = project_for(&["a"]);
    let opts = ExportOptions { format: ExportFormat::Ogg, sample_rate: 22_050, channels: ChannelMode::Stereo, ..Default::default() };
    let out = engine.render("s", &p, Some(&opts), sizes()).unwrap();
    assert_eq!(out.analysis.sample_rate, 22_050);
    assert_eq!(out.analysis.channels, 2);
    assert!((tone_amplitude(&out.buffer, 440.0) - 0.5).abs() < 0.05);
}

#[test]
fn release_session_frees_caches_and_playback() {
    let (engine, _) = fake_engine(48_000);
    engine.insert_source("a", signals::sine(440.0, 48_000, 0.2, 0.5));
    let mut p = project_for(&["a"]);
    p.tracks[0].effects.volume.gain_db = -3.0;
    engine.render("s1", &p, None, sizes()).unwrap();
    engine.render("s2", &p, None, sizes()).unwrap();
    engine.play("s1").unwrap();
    assert_eq!(engine.session_count(), 2);
    engine.release_session("s1");
    assert_eq!(engine.session_count(), 1);
    assert_eq!(engine.session_stats("s1").unwrap_err().code(), "ERR_SESSION_NOT_FOUND");
    let t = engine.transport_state();
    assert_eq!(t.state, PlayState::Stopped);
    assert_eq!(t.session_id, None);
    assert!(engine.transport().lock().buffer().is_none());
    assert_eq!(engine.play("s1").unwrap_err().code(), "ERR_SESSION_NOT_FOUND");
    // Releasing an inactive session does not touch the transport.
    engine.play("s2").unwrap();
    engine.release_session("unknown");
    assert_eq!(engine.transport_state().state, PlayState::Playing);
    // Wake: render again recomputes from scratch.
    engine.render("s1", &p, None, sizes()).unwrap();
    assert_eq!(engine.session_stats("s1").unwrap().get("volume"), Some(&1));
}

#[test]
fn transport_plays_last_render_resampled_to_device_rate() {
    let (engine, opened) = fake_engine(48_000);
    engine.insert_source("a", AudioBuffer::mono(24_000, vec![0.5; 24_000]));
    let p = project_for(&["a"]);
    assert_eq!(engine.play("s").unwrap_err().code(), "ERR_SESSION_NOT_FOUND");
    engine.render("s", &p, None, sizes()).unwrap();
    assert_eq!(opened.load(Ordering::SeqCst), 0, "device is opened lazily");
    engine.play("s").unwrap();
    assert_eq!(opened.load(Ordering::SeqCst), 1);
    let st = engine.transport_state();
    assert_eq!(st.state, PlayState::Playing);
    assert_eq!(st.session_id.as_deref(), Some("s"));
    assert!((st.duration - 1.0).abs() < 1e-3);
    assert_eq!(engine.transport().lock().buffer().unwrap().sample_rate, 48_000);
    // Pull like the device: 0.25 s at 48 kHz stereo.
    let mut out = vec![0.0f32; 24_000];
    engine.transport().lock().fill(&mut out, 2);
    assert!((engine.transport_state().position - 0.25).abs() < 1e-3);
    assert!((out[10_000] - 0.5).abs() < 0.01);
    // Seek while playing keeps playing from there.
    engine.seek(0.5);
    assert!((engine.transport_state().position - 0.5).abs() < 1e-9);
    engine.transport().lock().fill(&mut out, 2);
    assert!((engine.transport_state().position - 0.75).abs() < 0.01);
    engine.step(-0.1);
    assert!((engine.transport_state().position - 0.65).abs() < 0.01);
    engine.pause();
    assert_eq!(engine.transport_state().state, PlayState::Paused);
    engine.set_loop(true);
    assert!(engine.transport_state().loop_enabled);
    engine.play("s").unwrap();
    assert_eq!(opened.load(Ordering::SeqCst), 1, "device reused");
    engine.stop();
    let st = engine.transport_state();
    assert_eq!(st.state, PlayState::Stopped);
    assert_eq!(st.position, 0.0);
    engine.close_output();
    engine.play("s").unwrap();
    assert_eq!(opened.load(Ordering::SeqCst), 2, "reopened after close");
}

#[test]
fn rerender_of_active_session_keeps_position() {
    let (engine, _) = fake_engine(48_000);
    engine.insert_source("a", AudioBuffer::mono(48_000, vec![0.5; 48_000]));
    let mut p = project_for(&["a"]);
    engine.render("s", &p, None, sizes()).unwrap();
    engine.play("s").unwrap();
    engine.pause();
    engine.seek(0.4);
    p.tracks[0].gain_db = -6.0;
    engine.render("s", &p, None, sizes()).unwrap();
    let st = engine.transport_state();
    assert!((st.position - 0.4).abs() < 1e-6);
    assert_eq!(st.state, PlayState::Paused);
    let peak = engine.transport().lock().buffer().unwrap().peak();
    assert!((peak - 0.25).abs() < 0.01, "transport got the new render");
    // Rendering another session does not change the transport.
    engine.render("other", &project_for(&["a"]), None, sizes()).unwrap();
    assert_eq!(engine.transport_state().session_id.as_deref(), Some("s"));
    // Switching session resets the position.
    engine.play("other").unwrap();
    let st = engine.transport_state();
    assert_eq!(st.session_id.as_deref(), Some("other"));
    assert!(st.position < 0.01);
}

#[test]
fn play_without_device_reports_code() {
    let engine = no_device_engine();
    engine.insert_source("a", signals::sine(440.0, 8000, 0.1, 0.5));
    engine.render("s", &project_for(&["a"]), None, sizes()).unwrap();
    let e = engine.play("s").unwrap_err();
    assert_eq!(e.code(), "ERR_NO_AUDIO_DEVICE");
    assert!(e.to_string().starts_with("ERR_NO_AUDIO_DEVICE: "));
    assert_eq!(engine.transport_state().state, PlayState::Stopped);
    // Other transport calls stay safe.
    engine.pause();
    engine.stop();
    engine.seek(1.0);
    engine.set_loop(true);
    assert!(engine.transport_state().loop_enabled);
}

#[test]
fn engine_is_shareable_across_threads() {
    let engine = Arc::new(Engine::new());
    engine.insert_source("a", signals::sine(440.0, 8000, 0.2, 0.5));
    let handles: Vec<_> = (0..4)
        .map(|i| {
            let e = engine.clone();
            std::thread::spawn(move || {
                let mut p = project_for(&["a"]);
                p.tracks[0].gain_db = -(i as f32);
                e.render(&format!("s{i}"), &p, None, RenderSizes::default()).unwrap().analysis.peak_db
            })
        })
        .collect();
    let peaks: Vec<f32> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    for (i, p) in peaks.iter().enumerate() {
        assert!((p - (-6.02 - i as f32)).abs() < 0.05, "{i}: {p}");
    }
    assert_eq!(engine.session_count(), 4);
}
