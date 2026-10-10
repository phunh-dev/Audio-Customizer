//! Decoding of the supported input formats via symphonia.

use crate::buffer::AudioBuffer;
use crate::error::{AudioError, Result};
use serde::Serialize;
use std::fs::File;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub const SUPPORTED_EXTENSIONS: [&str; 6] = ["mp3", "wav", "aiff", "aif", "ogg", "flac"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub format: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub frames: u64,
    pub duration: f64,
    pub bit_depth: Option<u32>,
    pub file_size: u64,
}

#[derive(Debug, Clone)]
pub struct Decoded {
    pub buffer: AudioBuffer,
    pub info: SourceInfo,
}

pub fn extension_of(path: &Path) -> Option<String> {
    path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase())
}

pub fn is_supported_path(path: &Path) -> bool {
    extension_of(path).is_some_and(|e| SUPPORTED_EXTENSIONS.contains(&e.as_str()))
}

/// Canonical format name for an extension (`aif` -> `aiff`).
pub fn format_name(ext: &str) -> String {
    match ext {
        "aif" => "aiff".to_string(),
        other => other.to_string(),
    }
}

pub fn decode_file(path: &Path) -> Result<Decoded> {
    let ext = extension_of(path).unwrap_or_default();
    if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(AudioError::UnsupportedFormat(path.display().to_string()));
    }
    let file = File::open(path)?;
    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut decoded = decode_source(Box::new(file), &ext)?;
    decoded.info.file_size = file_size;
    Ok(decoded)
}

pub fn decode_bytes(bytes: Vec<u8>, ext: &str) -> Result<Decoded> {
    let size = bytes.len() as u64;
    let mut decoded = decode_source(Box::new(std::io::Cursor::new(bytes)), ext)?;
    decoded.info.file_size = size;
    Ok(decoded)
}

fn decode_source(source: Box<dyn MediaSource>, ext: &str) -> Result<Decoded> {
    let mss = MediaSourceStream::new(source, Default::default());
    let mut hint = Hint::new();
    hint.with_extension(ext);
    let format_opts = FormatOptions { enable_gapless: true, ..Default::default() };
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &MetadataOptions::default())
        .map_err(|e| match e {
            SymError::Unsupported(m) => AudioError::UnsupportedFormat(m.to_string()),
            other => AudioError::DecodeFailed(other.to_string()),
        })?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| AudioError::DecodeFailed("no audio track".into()))?;
    let track_id = track.id;
    let params = track.codec_params.clone();
    let mut decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .map_err(|e| AudioError::UnsupportedFormat(e.to_string()))?;

    let mut sample_rate = params.sample_rate.unwrap_or(0);
    let mut num_channels = params.channels.map(|c| c.count()).unwrap_or(0);
    let mut interleaved: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => break,
            Err(e) => return Err(AudioError::DecodeFailed(e.to_string())),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                sample_rate = spec.rate;
                num_channels = spec.channels.count();
                let needed = decoded.capacity() as u64;
                let sb = match &mut sample_buf {
                    Some(sb) if sb.capacity() as u64 >= needed * num_channels as u64 => sb,
                    _ => sample_buf.insert(SampleBuffer::<f32>::new(needed, spec)),
                };
                sb.copy_interleaved_ref(decoded);
                interleaved.extend_from_slice(sb.samples());
            }
            Err(SymError::DecodeError(_)) => continue,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(AudioError::DecodeFailed(e.to_string())),
        }
    }

    if num_channels == 0 || sample_rate == 0 {
        return Err(AudioError::DecodeFailed("missing stream parameters".into()));
    }
    let buffer = AudioBuffer::from_interleaved(sample_rate, num_channels, &interleaved);
    let info = SourceInfo {
        format: format_name(ext),
        sample_rate,
        channels: num_channels as u32,
        frames: buffer.frames() as u64,
        duration: buffer.duration_secs(),
        bit_depth: params.bits_per_sample,
        file_size: 0,
    };
    Ok(Decoded { buffer, info })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_extensions_are_case_insensitive() {
        for p in ["a.MP3", "b.wav", "c.AIFF", "d.aif", "e.Ogg", "f.flac"] {
            assert!(is_supported_path(Path::new(p)), "{p}");
        }
        for p in ["a.m4a", "b.txt", "noext"] {
            assert!(!is_supported_path(Path::new(p)), "{p}");
        }
        assert_eq!(format_name("aif"), "aiff");
        assert_eq!(format_name("wav"), "wav");
    }

    #[test]
    fn missing_file_reports_not_found() {
        let err = decode_file(Path::new("definitely_missing_file.wav")).unwrap_err();
        assert_eq!(err.code(), "ERR_FILE_NOT_FOUND");
    }

    #[test]
    fn unsupported_extension_is_rejected() {
        let err = decode_file(Path::new("x.m4a")).unwrap_err();
        assert_eq!(err.code(), "ERR_UNSUPPORTED_FORMAT");
    }

    #[test]
    fn corrupt_data_fails_cleanly() {
        let err = decode_bytes(vec![1, 2, 3, 4, 5, 6, 7, 8, 9], "wav").unwrap_err();
        assert!(matches!(err.code(), "ERR_DECODE_FAILED" | "ERR_UNSUPPORTED_FORMAT"), "{err}");
    }
}
