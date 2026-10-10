//! Error type shared by the whole engine.
//!
//! Every variant maps to a stable error code (`ERR_*`). The UI never shows
//! the Rust message directly: it translates the code through i18n and may
//! show the detail as secondary information.

use thiserror::Error;

#[derive(Error, Debug, Clone, PartialEq)]
pub enum AudioError {
    #[error("ERR_FILE_NOT_FOUND: {0}")]
    FileNotFound(String),
    #[error("ERR_UNSUPPORTED_FORMAT: {0}")]
    UnsupportedFormat(String),
    #[error("ERR_DECODE_FAILED: {0}")]
    DecodeFailed(String),
    #[error("ERR_ENCODE_FAILED: {0}")]
    EncodeFailed(String),
    #[error("ERR_INVALID_PARAM: {0}")]
    InvalidParam(String),
    #[error("ERR_IO: {0}")]
    Io(String),
    #[error("ERR_NO_AUDIO_DEVICE: {0}")]
    NoAudioDevice(String),
    #[error("ERR_SOURCE_NOT_LOADED: {0}")]
    SourceNotLoaded(String),
    #[error("ERR_SESSION_NOT_FOUND: {0}")]
    SessionNotFound(String),
    #[error("ERR_EMPTY_PROJECT")]
    EmptyProject,
}

impl AudioError {
    pub fn code(&self) -> &'static str {
        match self {
            AudioError::FileNotFound(_) => "ERR_FILE_NOT_FOUND",
            AudioError::UnsupportedFormat(_) => "ERR_UNSUPPORTED_FORMAT",
            AudioError::DecodeFailed(_) => "ERR_DECODE_FAILED",
            AudioError::EncodeFailed(_) => "ERR_ENCODE_FAILED",
            AudioError::InvalidParam(_) => "ERR_INVALID_PARAM",
            AudioError::Io(_) => "ERR_IO",
            AudioError::NoAudioDevice(_) => "ERR_NO_AUDIO_DEVICE",
            AudioError::SourceNotLoaded(_) => "ERR_SOURCE_NOT_LOADED",
            AudioError::SessionNotFound(_) => "ERR_SESSION_NOT_FOUND",
            AudioError::EmptyProject => "ERR_EMPTY_PROJECT",
        }
    }

    pub fn detail(&self) -> String {
        match self {
            AudioError::FileNotFound(d)
            | AudioError::UnsupportedFormat(d)
            | AudioError::DecodeFailed(d)
            | AudioError::EncodeFailed(d)
            | AudioError::InvalidParam(d)
            | AudioError::Io(d)
            | AudioError::NoAudioDevice(d)
            | AudioError::SourceNotLoaded(d)
            | AudioError::SessionNotFound(d) => d.clone(),
            AudioError::EmptyProject => String::new(),
        }
    }
}

impl From<std::io::Error> for AudioError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            AudioError::FileNotFound(e.to_string())
        } else {
            AudioError::Io(e.to_string())
        }
    }
}

pub type Result<T> = std::result::Result<T, AudioError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_variant_has_code_prefix_in_message() {
        let all = [
            AudioError::FileNotFound("a".into()),
            AudioError::UnsupportedFormat("a".into()),
            AudioError::DecodeFailed("a".into()),
            AudioError::EncodeFailed("a".into()),
            AudioError::InvalidParam("a".into()),
            AudioError::Io("a".into()),
            AudioError::NoAudioDevice("a".into()),
            AudioError::SourceNotLoaded("a".into()),
            AudioError::SessionNotFound("a".into()),
            AudioError::EmptyProject,
        ];
        for e in all {
            assert!(e.to_string().starts_with(e.code()), "{e}");
            if e != AudioError::EmptyProject {
                assert_eq!(e.detail(), "a");
            }
        }
    }

    #[test]
    fn io_not_found_maps_to_file_not_found() {
        let e: AudioError = std::io::Error::new(std::io::ErrorKind::NotFound, "x").into();
        assert_eq!(e.code(), "ERR_FILE_NOT_FOUND");
        let e: AudioError = std::io::Error::other("x").into();
        assert_eq!(e.code(), "ERR_IO");
    }
}
