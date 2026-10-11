//! Encoding of the final buffer into the supported output formats.

use crate::buffer::AudioBuffer;
use crate::dsp::resample::{resample, ResampleQuality};
use crate::error::{AudioError, Result};
use crate::signals::Rng;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::num::{NonZeroU32, NonZeroU8};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    #[default]
    Wav,
    Aiff,
    Flac,
    Mp3,
    Ogg,
}

impl ExportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Wav => "wav",
            ExportFormat::Aiff => "aiff",
            ExportFormat::Flac => "flac",
            ExportFormat::Mp3 => "mp3",
            ExportFormat::Ogg => "ogg",
        }
    }

    pub fn is_lossy(self) -> bool {
        matches!(self, ExportFormat::Mp3 | ExportFormat::Ogg)
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChannelMode {
    #[default]
    Source,
    Mono,
    Stereo,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum BitrateMode {
    #[default]
    Cbr,
    Vbr,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportOptions {
    pub format: ExportFormat,
    /// 0 keeps the project sample rate.
    pub sample_rate: u32,
    pub channels: ChannelMode,
    /// 16, 24 or 32 (32 = float for WAV, int for AIFF, 24 for FLAC).
    pub bit_depth: u16,
    pub bitrate_mode: BitrateMode,
    pub bitrate_kbps: u32,
    /// 0.0 (smallest) .. 1.0 (best) for VBR.
    pub vbr_quality: f32,
    pub resample_quality: ResampleQuality,
    pub dither: bool,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            format: ExportFormat::Wav,
            sample_rate: 0,
            channels: ChannelMode::Source,
            bit_depth: 16,
            bitrate_mode: BitrateMode::Cbr,
            bitrate_kbps: 192,
            vbr_quality: 0.7,
            resample_quality: ResampleQuality::Best,
            dither: true,
        }
    }
}

pub const MP3_SAMPLE_RATES: [u32; 9] = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
pub const MP3_BITRATES: [u32; 16] = [8, 16, 24, 32, 40, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

/// Validate options against the buffer they will be applied to.
pub fn validate(opts: &ExportOptions, sample_rate: u32, channels: usize) -> Result<()> {
    if !matches!(opts.bit_depth, 16 | 24 | 32) {
        return Err(AudioError::InvalidParam(format!("bitDepth {}", opts.bit_depth)));
    }
    if !(0.0..=1.0).contains(&opts.vbr_quality) {
        return Err(AudioError::InvalidParam(format!("vbrQuality {}", opts.vbr_quality)));
    }
    let sr = if opts.sample_rate == 0 { sample_rate } else { opts.sample_rate };
    if !(4000..=384_000).contains(&sr) {
        return Err(AudioError::InvalidParam(format!("sampleRate {sr}")));
    }
    if opts.format == ExportFormat::Mp3 {
        if !MP3_SAMPLE_RATES.contains(&sr) {
            return Err(AudioError::InvalidParam(format!("mp3 sampleRate {sr}")));
        }
        if opts.bitrate_mode == BitrateMode::Cbr && !MP3_BITRATES.contains(&opts.bitrate_kbps) {
            return Err(AudioError::InvalidParam(format!("mp3 bitrate {}", opts.bitrate_kbps)));
        }
        let ch = output_channels(opts.channels, channels);
        if ch > 2 {
            return Err(AudioError::InvalidParam("mp3 supports at most 2 channels".into()));
        }
    }
    if opts.format == ExportFormat::Ogg && opts.bitrate_mode == BitrateMode::Cbr && !(32..=500).contains(&opts.bitrate_kbps) {
        return Err(AudioError::InvalidParam(format!("ogg bitrate {}", opts.bitrate_kbps)));
    }
    Ok(())
}

pub fn output_channels(mode: ChannelMode, source_channels: usize) -> usize {
    match mode {
        ChannelMode::Source => source_channels.max(1),
        ChannelMode::Mono => 1,
        ChannelMode::Stereo => 2,
    }
}

/// Channel conversion + resampling according to the options.
pub fn prepare(buf: &AudioBuffer, opts: &ExportOptions) -> Result<AudioBuffer> {
    validate(opts, buf.sample_rate, buf.num_channels())?;
    let mut ch = output_channels(opts.channels, buf.num_channels());
    if opts.format == ExportFormat::Mp3 {
        ch = ch.min(2);
    }
    let converted = buf.with_channels(ch);
    let target = if opts.sample_rate == 0 { buf.sample_rate } else { opts.sample_rate };
    Ok(resample(&converted, target, opts.resample_quality))
}

/// Full export pipeline: prepare + encode.
pub fn export_bytes(buf: &AudioBuffer, opts: &ExportOptions) -> Result<Vec<u8>> {
    let prepared = prepare(buf, opts)?;
    encode(&prepared, opts)
}

/// Encode a buffer that already has the target rate/channels.
pub fn encode(buf: &AudioBuffer, opts: &ExportOptions) -> Result<Vec<u8>> {
    if buf.is_empty() {
        return Err(AudioError::EmptyProject);
    }
    match opts.format {
        ExportFormat::Wav => encode_wav(buf, opts.bit_depth, opts.dither),
        ExportFormat::Aiff => encode_aiff(buf, opts.bit_depth, opts.dither),
        ExportFormat::Flac => encode_flac(buf, opts.bit_depth.min(24), opts.dither),
        ExportFormat::Mp3 => encode_mp3(buf, opts),
        ExportFormat::Ogg => encode_ogg(buf, opts),
    }
}

/// Quantise interleaved float samples to signed integers of `bits`, with
/// optional TPDF dither.
pub fn quantize(buf: &AudioBuffer, bits: u16, dither: bool) -> Vec<i32> {
    let max = ((1i64 << (bits - 1)) - 1) as f64;
    let min = -((1i64 << (bits - 1)) as f64);
    let mut rng = Rng::new(0x5EED);
    buf.to_interleaved()
        .into_iter()
        .map(|s| {
            let mut v = s as f64 * (max + 1.0);
            if dither {
                v += (rng.next_unit() - rng.next_unit()) as f64;
            }
            v.round().clamp(min, max) as i32
        })
        .collect()
}

fn encode_wav(buf: &AudioBuffer, bits: u16, dither: bool) -> Result<Vec<u8>> {
    let float = bits == 32;
    let spec = hound::WavSpec {
        channels: buf.num_channels() as u16,
        sample_rate: buf.sample_rate,
        bits_per_sample: bits,
        sample_format: if float { hound::SampleFormat::Float } else { hound::SampleFormat::Int },
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut w = hound::WavWriter::new(&mut cursor, spec).map_err(|e| AudioError::EncodeFailed(e.to_string()))?;
        if float {
            for s in buf.to_interleaved() {
                w.write_sample(s).map_err(|e| AudioError::EncodeFailed(e.to_string()))?;
            }
        } else {
            for s in quantize(buf, bits, dither) {
                w.write_sample(s).map_err(|e| AudioError::EncodeFailed(e.to_string()))?;
            }
        }
        w.finalize().map_err(|e| AudioError::EncodeFailed(e.to_string()))?;
    }
    Ok(cursor.into_inner())
}

/// IEEE 754 80-bit extended representation of an integer sample rate.
fn f80_from_u32(v: u32) -> [u8; 10] {
    let mut out = [0u8; 10];
    if v == 0 {
        return out;
    }
    let e = 31 - v.leading_zeros();
    let exponent = 16383 + e as u16;
    let mantissa = (v as u64) << (63 - e);
    out[..2].copy_from_slice(&exponent.to_be_bytes());
    out[2..].copy_from_slice(&mantissa.to_be_bytes());
    out
}

fn encode_aiff(buf: &AudioBuffer, bits: u16, dither: bool) -> Result<Vec<u8>> {
    let channels = buf.num_channels() as u16;
    let frames = buf.frames() as u32;
    let bytes_per = (bits / 8) as usize;
    let samples = quantize(buf, bits, dither && bits < 32);
    let data_len = samples.len() * bytes_per;
    let ssnd_len = 8 + data_len;
    let form_len = 4 + (8 + 18) + (8 + ssnd_len);
    let mut out = Vec::with_capacity(8 + form_len + 1);
    out.extend_from_slice(b"FORM");
    out.extend_from_slice(&(form_len as u32 + (data_len % 2) as u32).to_be_bytes());
    out.extend_from_slice(b"AIFF");
    out.extend_from_slice(b"COMM");
    out.extend_from_slice(&18u32.to_be_bytes());
    out.extend_from_slice(&channels.to_be_bytes());
    out.extend_from_slice(&frames.to_be_bytes());
    out.extend_from_slice(&bits.to_be_bytes());
    out.extend_from_slice(&f80_from_u32(buf.sample_rate));
    out.extend_from_slice(b"SSND");
    out.extend_from_slice(&(ssnd_len as u32).to_be_bytes());
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(&0u32.to_be_bytes());
    for s in samples {
        let be = s.to_be_bytes();
        out.extend_from_slice(&be[4 - bytes_per..]);
    }
    if data_len % 2 == 1 {
        out.push(0);
    }
    Ok(out)
}

fn encode_flac(buf: &AudioBuffer, bits: u16, dither: bool) -> Result<Vec<u8>> {
    use flacenc::component::BitRepr;
    use flacenc::error::Verify;
    let samples = quantize(buf, bits, dither);
    let config = flacenc::config::Encoder::default()
        .into_verified()
        .map_err(|(_, e)| AudioError::EncodeFailed(format!("{e:?}")))?;
    let source = flacenc::source::MemSource::from_samples(&samples, buf.num_channels(), bits as usize, buf.sample_rate as usize);
    let stream = flacenc::encode_with_fixed_block_size(&config, source, config.block_size)
        .map_err(|e| AudioError::EncodeFailed(format!("{e:?}")))?;
    let mut sink = flacenc::bitsink::ByteSink::new();
    stream.write(&mut sink).map_err(|e| AudioError::EncodeFailed(format!("{e:?}")))?;
    let mut bytes = sink.as_slice().to_vec();
    fix_flac_min_block_size(&mut bytes);
    Ok(bytes)
}

/// flacenc stores the (shorter) last block length as STREAMINFO's minimum
/// block size. The spec exempts the last block, and decoders such as
/// symphonia treat min != max as a variable-blocksize stream and then fail
/// to sync on fixed-blocksize frame headers. Set min = max.
fn fix_flac_min_block_size(bytes: &mut [u8]) {
    // "fLaC" (4) + metadata block header (4) -> STREAMINFO min(2) max(2)
    if bytes.len() >= 12 && &bytes[0..4] == b"fLaC" && bytes[4] & 0x7F == 0 {
        let (min, max) = bytes[8..12].split_at_mut(2);
        min.copy_from_slice(max);
    }
}

fn nearest_mp3_bitrate(kbps: u32) -> mp3lame_encoder::Bitrate {
    use mp3lame_encoder::Bitrate::*;
    let all = [
        Kbps8, Kbps16, Kbps24, Kbps32, Kbps40, Kbps48, Kbps64, Kbps80, Kbps96, Kbps112, Kbps128, Kbps160, Kbps192,
        Kbps224, Kbps256, Kbps320,
    ];
    let idx = MP3_BITRATES
        .iter()
        .enumerate()
        .min_by_key(|(_, b)| (**b as i64 - kbps as i64).abs())
        .map(|(i, _)| i)
        .unwrap_or(10);
    all[idx]
}

fn mp3_quality(q: f32) -> mp3lame_encoder::Quality {
    use mp3lame_encoder::Quality::*;
    // vbr_quality 1.0 -> Best (V0), 0.0 -> Worst (V9)
    let all = [Best, SecondBest, NearBest, VeryNice, Nice, Good, Decent, Ok, SecondWorst, Worst];
    let idx = ((1.0 - q.clamp(0.0, 1.0)) * 9.0).round() as usize;
    all[idx.min(9)]
}

fn encode_mp3(buf: &AudioBuffer, opts: &ExportOptions) -> Result<Vec<u8>> {
    use mp3lame_encoder::{Builder, DualPcm, FlushNoGap, MonoPcm};
    let err = |e: &dyn std::fmt::Debug| AudioError::EncodeFailed(format!("mp3: {e:?}"));
    let mut b = Builder::new().ok_or_else(|| AudioError::EncodeFailed("mp3: lame init".into()))?;
    b.set_num_channels(buf.num_channels() as u8).map_err(|e| err(&e))?;
    b.set_sample_rate(buf.sample_rate).map_err(|e| err(&e))?;
    b.set_quality(mp3lame_encoder::Quality::Best).map_err(|e| err(&e))?;
    match opts.bitrate_mode {
        BitrateMode::Cbr => {
            b.set_vbr_mode(mp3lame_encoder::VbrMode::Off).map_err(|e| err(&e))?;
            b.set_brate(nearest_mp3_bitrate(opts.bitrate_kbps)).map_err(|e| err(&e))?;
        }
        BitrateMode::Vbr => {
            b.set_vbr_mode(mp3lame_encoder::VbrMode::Mtrh).map_err(|e| err(&e))?;
            b.set_vbr_quality(mp3_quality(opts.vbr_quality)).map_err(|e| err(&e))?;
        }
    }
    let mut enc = b.build().map_err(|e| err(&e))?;
    let mut out = Vec::new();
    let chunk = 8192;
    let frames = buf.frames();
    let mut pos = 0;
    while pos < frames {
        let end = (pos + chunk).min(frames);
        out.reserve(mp3lame_encoder::max_required_buffer_size(end - pos));
        if buf.num_channels() == 1 {
            enc.encode_to_vec(MonoPcm(&buf.channels[0][pos..end]), &mut out).map_err(|e| err(&e))?;
        } else {
            let input = DualPcm { left: &buf.channels[0][pos..end], right: &buf.channels[1][pos..end] };
            enc.encode_to_vec(input, &mut out).map_err(|e| err(&e))?;
        }
        pos = end;
    }
    out.reserve(7200);
    enc.flush_to_vec::<FlushNoGap>(&mut out).map_err(|e| err(&e))?;
    Ok(out)
}

fn encode_ogg(buf: &AudioBuffer, opts: &ExportOptions) -> Result<Vec<u8>> {
    use vorbis_rs::{VorbisBitrateManagementStrategy, VorbisEncoderBuilder};
    let err = |e: &dyn std::fmt::Display| AudioError::EncodeFailed(format!("ogg: {e}"));
    let sr = NonZeroU32::new(buf.sample_rate).ok_or_else(|| AudioError::InvalidParam("sample rate".into()))?;
    let ch = NonZeroU8::new(buf.num_channels() as u8).ok_or_else(|| AudioError::InvalidParam("channels".into()))?;
    let strategy = match opts.bitrate_mode {
        BitrateMode::Cbr => VorbisBitrateManagementStrategy::Abr {
            average_bitrate: NonZeroU32::new(opts.bitrate_kbps * 1000).unwrap_or(NonZeroU32::MIN),
        },
        BitrateMode::Vbr => VorbisBitrateManagementStrategy::QualityVbr {
            // Map 0..1 to the encoder's -0.1..1 range.
            target_quality: -0.1 + 1.1 * opts.vbr_quality.clamp(0.0, 1.0),
        },
    };
    let build = |strategy| {
        let mut builder = VorbisEncoderBuilder::new_with_serial(sr, ch, Vec::new(), 0x41554443);
        builder.bitrate_management_strategy(strategy);
        builder.build()
    };
    let mut enc = match build(strategy) {
        Ok(e) => e,
        Err(first) => {
            // libvorbis only supports bitrates its modes cover for the given
            // rate/channel layout; step down to the nearest supported one.
            let mut found = None;
            if let VorbisBitrateManagementStrategy::Abr { average_bitrate } = strategy {
                let mut kbps = average_bitrate.get() / 1000;
                while found.is_none() && kbps > 16 {
                    kbps -= 8;
                    let s = VorbisBitrateManagementStrategy::Abr { average_bitrate: NonZeroU32::new(kbps * 1000).unwrap() };
                    found = build(s).ok();
                }
            }
            found.ok_or_else(|| err(&first))?
        }
    };
    let frames = buf.frames();
    let mut pos = 0;
    while pos < frames {
        let end = (pos + 1024).min(frames);
        let block: Vec<&[f32]> = buf.channels.iter().map(|c| &c[pos..end]).collect();
        enc.encode_audio_block(&block).map_err(|e| err(&e))?;
        pos = end;
    }
    enc.finish().map_err(|e| err(&e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{dominant_frequency, tone_amplitude};
    use crate::decode::decode_bytes;
    use crate::signals::sine;

    fn stereo_sine(sr: u32) -> AudioBuffer {
        let l = sine(440.0, sr, 1.0, 0.5);
        let r = sine(440.0, sr, 1.0, 0.25);
        AudioBuffer::from_channels(sr, vec![l.channels[0].clone(), r.channels[0].clone()])
    }

    fn opts(format: ExportFormat) -> ExportOptions {
        ExportOptions { format, ..Default::default() }
    }

    #[test]
    fn round_trip_all_formats() {
        let src = stereo_sine(44100);
        for fmt in [ExportFormat::Wav, ExportFormat::Aiff, ExportFormat::Flac, ExportFormat::Mp3, ExportFormat::Ogg] {
            let bytes = export_bytes(&src, &opts(fmt)).unwrap();
            let dec = decode_bytes(bytes, fmt.extension()).unwrap_or_else(|e| panic!("{fmt:?}: {e}"));
            let b = dec.buffer;
            assert_eq!(b.sample_rate, 44100, "{fmt:?}");
            assert_eq!(b.num_channels(), 2, "{fmt:?}");
            let len_err = (b.frames() as i64 - src.frames() as i64).abs();
            let tolerance = if fmt.is_lossy() { 2400 } else { 0 };
            assert!(len_err <= tolerance, "{fmt:?} length {} vs {}", b.frames(), src.frames());
            assert!((dominant_frequency(&b) - 440.0).abs() < 3.0, "{fmt:?}");
            let left = AudioBuffer::mono(44100, b.channels[0].clone());
            let right = AudioBuffer::mono(44100, b.channels[1].clone());
            let tol = if fmt.is_lossy() { 0.03 } else { 0.001 };
            assert!((tone_amplitude(&left, 440.0) - 0.5).abs() < tol, "{fmt:?} L");
            assert!((tone_amplitude(&right, 440.0) - 0.25).abs() < tol, "{fmt:?} R");
            if !fmt.is_lossy() {
                let max_err = src.channels[0].iter().zip(&b.channels[0]).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
                assert!(max_err < 2.0 / 32768.0, "{fmt:?} max err {max_err}");
            }
        }
    }

    #[test]
    fn bit_depths_are_respected() {
        let src = sine(1000.0, 48000, 0.2, 0.5);
        for (fmt, bits) in [
            (ExportFormat::Wav, 16),
            (ExportFormat::Wav, 24),
            (ExportFormat::Wav, 32),
            (ExportFormat::Aiff, 16),
            (ExportFormat::Aiff, 24),
            (ExportFormat::Flac, 16),
            (ExportFormat::Flac, 24),
        ] {
            let o = ExportOptions { format: fmt, bit_depth: bits, ..Default::default() };
            let dec = decode_bytes(export_bytes(&src, &o).unwrap(), fmt.extension()).unwrap();
            assert_eq!(dec.info.bit_depth, Some(bits as u32), "{fmt:?} {bits}");
            let max_err = src.channels[0].iter().zip(&dec.buffer.channels[0]).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
            let lsb = 1.0 / (1u64 << (bits - 1)) as f32;
            assert!(max_err <= lsb * 2.0, "{fmt:?} {bits}: {max_err}");
        }
    }

    #[test]
    fn wav_size_is_exact() {
        let src = AudioBuffer::new(22050, 1, 22050);
        let o = ExportOptions { bit_depth: 16, ..Default::default() };
        assert_eq!(export_bytes(&src, &o).unwrap().len(), 44 + 22050 * 2);
        // hound uses WAVE_FORMAT_EXTENSIBLE (68 byte header) above 16 bit.
        let o24 = ExportOptions { bit_depth: 24, channels: ChannelMode::Stereo, ..Default::default() };
        assert_eq!(export_bytes(&src, &o24).unwrap().len(), 68 + 22050 * 2 * 3);
    }

    #[test]
    fn aiff_header_and_size() {
        let src = AudioBuffer::new(44100, 2, 100);
        let bytes = export_bytes(&src, &opts(ExportFormat::Aiff)).unwrap();
        assert_eq!(&bytes[0..4], b"FORM");
        assert_eq!(&bytes[8..12], b"AIFF");
        assert_eq!(bytes.len(), 12 + 26 + 16 + 100 * 2 * 2);
        assert_eq!(f80_from_u32(44100), [0x40, 0x0E, 0xAC, 0x44, 0, 0, 0, 0, 0, 0]);
        assert_eq!(f80_from_u32(0), [0; 10]);
    }

    #[test]
    fn sample_rate_and_channel_conversion() {
        let src = stereo_sine(44100);
        let o = ExportOptions { sample_rate: 22050, channels: ChannelMode::Mono, ..Default::default() };
        let dec = decode_bytes(export_bytes(&src, &o).unwrap(), "wav").unwrap();
        assert_eq!(dec.buffer.sample_rate, 22050);
        assert_eq!(dec.buffer.num_channels(), 1);
        assert_eq!(dec.buffer.frames(), 22050);
        assert!((dominant_frequency(&dec.buffer) - 440.0).abs() < 2.0);
        let mono = sine(440.0, 44100, 0.1, 0.5);
        let o = ExportOptions { channels: ChannelMode::Stereo, ..Default::default() };
        assert_eq!(decode_bytes(export_bytes(&mono, &o).unwrap(), "wav").unwrap().buffer.num_channels(), 2);
    }

    #[test]
    fn mp3_bitrate_controls_size() {
        let src = stereo_sine(44100);
        let size = |kbps| {
            let o = ExportOptions { format: ExportFormat::Mp3, bitrate_kbps: kbps, ..Default::default() };
            export_bytes(&src, &o).unwrap().len() as f64
        };
        let s128 = size(128);
        let s320 = size(320);
        // CBR: ~ bitrate * duration / 8 (1 s of audio).
        assert!((s128 - 16000.0).abs() / 16000.0 < 0.15, "{s128}");
        assert!(s320 > s128 * 2.0);
    }

    #[test]
    fn vbr_quality_controls_size() {
        let noise = crate::signals::white_noise(44100, 1.0, 0.3, 1);
        for fmt in [ExportFormat::Mp3, ExportFormat::Ogg] {
            let size = |q: f32| {
                let o = ExportOptions { format: fmt, bitrate_mode: BitrateMode::Vbr, vbr_quality: q, ..Default::default() };
                export_bytes(&noise, &o).unwrap().len()
            };
            assert!(size(1.0) > size(0.0), "{fmt:?}");
        }
    }

    #[test]
    fn ogg_bitrate_controls_size() {
        let noise = crate::signals::white_noise(44100, 2.0, 0.3, 2);
        let size = |kbps| {
            let o = ExportOptions { format: ExportFormat::Ogg, bitrate_kbps: kbps, ..Default::default() };
            export_bytes(&noise, &o).unwrap().len()
        };
        assert!(size(256) > size(64));
    }

    #[test]
    fn invalid_options_are_rejected() {
        let src = sine(440.0, 44100, 0.1, 0.5);
        let bad = [
            ExportOptions { bit_depth: 12, ..Default::default() },
            ExportOptions { vbr_quality: 2.0, ..Default::default() },
            ExportOptions { sample_rate: 1000, ..Default::default() },
            ExportOptions { format: ExportFormat::Mp3, sample_rate: 96000, ..Default::default() },
            ExportOptions { format: ExportFormat::Mp3, bitrate_kbps: 100, ..Default::default() },
            ExportOptions { format: ExportFormat::Ogg, bitrate_kbps: 10, ..Default::default() },
        ];
        for o in bad {
            assert_eq!(export_bytes(&src, &o).unwrap_err().code(), "ERR_INVALID_PARAM", "{o:?}");
        }
        let quad = AudioBuffer::new(44100, 4, 10);
        let o = ExportOptions { format: ExportFormat::Mp3, ..Default::default() };
        assert_eq!(validate(&o, 44100, 4).unwrap_err().code(), "ERR_INVALID_PARAM");
        assert!(export_bytes(&quad, &ExportOptions::default()).is_ok());
    }

    #[test]
    fn empty_buffer_is_rejected() {
        let e = AudioBuffer::new(44100, 1, 0);
        assert_eq!(export_bytes(&e, &ExportOptions::default()).unwrap_err().code(), "ERR_EMPTY_PROJECT");
    }

    #[test]
    fn quantize_clamps_and_dithers() {
        let b = AudioBuffer::mono(10, vec![2.0, -2.0, 0.0]);
        assert_eq!(quantize(&b, 16, false), vec![32767, -32768, 0]);
        let quiet = AudioBuffer::mono(10, vec![0.0; 1000]);
        let d = quantize(&quiet, 16, true);
        assert!(d.iter().any(|v| *v != 0));
        assert!(d.iter().all(|v| v.abs() <= 1));
    }

    #[test]
    fn options_deserialize_from_camel_case_json() {
        let o: ExportOptions = serde_json::from_str(
            r#"{"format":"mp3","sampleRate":22050,"channels":"mono","bitDepth":24,"bitrateMode":"vbr","bitrateKbps":96,"vbrQuality":0.4,"resampleQuality":"fast","dither":false}"#,
        )
        .unwrap();
        assert_eq!(o.format, ExportFormat::Mp3);
        assert_eq!(o.channels, ChannelMode::Mono);
        assert_eq!(o.resample_quality, ResampleQuality::Fast);
        let d: ExportOptions = serde_json::from_str("{}").unwrap();
        assert_eq!(d, ExportOptions::default());
    }

    #[test]
    fn helpers() {
        assert_eq!(output_channels(ChannelMode::Source, 0), 1);
        assert_eq!(output_channels(ChannelMode::Stereo, 1), 2);
        assert!(ExportFormat::Ogg.is_lossy());
        assert!(!ExportFormat::Flac.is_lossy());
        assert!(matches!(nearest_mp3_bitrate(130), mp3lame_encoder::Bitrate::Kbps128));
        assert!(matches!(mp3_quality(1.0), mp3lame_encoder::Quality::Best));
        assert!(matches!(mp3_quality(0.0), mp3lame_encoder::Quality::Worst));
    }
}
