//! Audio-Customizer engine: decoding, DSP, mixing, rendering, analysis,
//! encoding and playback. Pure Rust, independent of the UI bridge.

pub mod analysis;
pub mod buffer;
pub mod chain;
pub mod decode;
pub mod dsp;
pub mod encode;
pub mod engine;
pub mod error;
pub mod mix;
pub mod playback;
pub mod project;
pub mod render;
pub mod signals;

pub use buffer::AudioBuffer;
pub use error::{AudioError, Result};

pub fn ping() -> &'static str {
    "pong"
}
