//! Project model shared with the UI (identical camelCase JSON to
//! `src/shared/types.ts`). Rendering never mutates it.

use crate::dsp::denoise::DenoiseSettings;
use crate::dsp::eq::EqSettings;
use crate::dsp::fade::Fade;
use crate::dsp::filter::FilterSettings;
use crate::dsp::gain::VolumeSettings;
use crate::dsp::loop_builder::LoopSettings;
use crate::dsp::silence::TrimSilenceSettings;
use crate::dsp::stretch::PitchTempoSettings;
use crate::error::{AudioError, Result};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EffectChain {
    pub denoise: DenoiseSettings,
    pub pitch_tempo: PitchTempoSettings,
    pub filters: FilterSettings,
    pub eq: EqSettings,
    pub volume: VolumeSettings,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Track {
    pub id: String,
    pub source_id: String,
    pub name: String,
    /// Seconds on the timeline (>= 0).
    pub offset: f64,
    /// Seconds inside the source.
    pub clip_start: f64,
    /// Seconds inside the source; `None` = end of the source.
    pub clip_end: Option<f64>,
    pub gain_db: f32,
    pub pan: f32,
    pub mute: bool,
    pub solo: bool,
    pub fade_in: Fade,
    pub fade_out: Fade,
    pub effects: EffectChain,
}

impl Default for Track {
    fn default() -> Self {
        Self {
            id: String::new(),
            source_id: String::new(),
            name: String::new(),
            offset: 0.0,
            clip_start: 0.0,
            clip_end: None,
            gain_db: 0.0,
            pan: 0.0,
            mute: false,
            solo: false,
            fade_in: Fade::default(),
            fade_out: Fade::default(),
            effects: EffectChain::default(),
        }
    }
}

impl Track {
    pub fn new(id: impl Into<String>, source_id: impl Into<String>) -> Self {
        Self { id: id.into(), source_id: source_id.into(), ..Default::default() }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MasterSettings {
    pub effects: EffectChain,
    #[serde(rename = "loop")]
    pub loop_settings: LoopSettings,
    pub trim_silence: TrimSilenceSettings,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub tracks: Vec<Track>,
    pub master: MasterSettings,
}

impl Project {
    pub fn from_json(json: &str) -> Result<Self> {
        serde_json::from_str(json).map_err(|e| AudioError::InvalidParam(format!("project: {e}")))
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("project serialises")
    }

    /// Tracks that are heard: not muted and, when any audible track is
    /// soloed, only the soloed ones.
    pub fn audible_tracks(&self) -> Vec<&Track> {
        let any_solo = self.tracks.iter().any(|t| t.solo && !t.mute);
        self.tracks.iter().filter(|t| !t.mute && (!any_solo || t.solo)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::fade::FadeCurve;

    #[test]
    fn empty_json_gives_defaults() {
        let p = Project::from_json("{}").unwrap();
        assert!(p.tracks.is_empty());
        assert_eq!(p.master, MasterSettings::default());
        let t: Track = serde_json::from_str(r#"{"id":"a","sourceId":"s"}"#).unwrap();
        assert_eq!(t.clip_end, None);
        assert_eq!(t.effects, EffectChain::default());
        assert_eq!(t.fade_in, Fade::default());
    }

    #[test]
    fn camel_case_and_loop_rename() {
        let mut p = Project::default();
        let mut t = Track::new("t1", "src");
        t.clip_end = Some(1.5);
        t.fade_in = Fade { duration: 0.2, curve: FadeCurve::SCurve };
        p.tracks.push(t);
        let v: serde_json::Value = serde_json::from_str(&p.to_json()).unwrap();
        let tr = &v["tracks"][0];
        for key in ["id", "sourceId", "name", "offset", "clipStart", "clipEnd", "gainDb", "pan", "mute", "solo", "fadeIn", "fadeOut", "effects"] {
            assert!(tr.get(key).is_some(), "missing {key}");
        }
        assert_eq!(tr["fadeIn"]["curve"], "sCurve");
        for key in ["denoise", "pitchTempo", "filters", "eq", "volume"] {
            assert!(tr["effects"].get(key).is_some(), "missing effects.{key}");
        }
        for key in ["effects", "loop", "trimSilence"] {
            assert!(v["master"].get(key).is_some(), "missing master.{key}");
        }
        assert!(Project::from_json(&p.to_json()).unwrap() == p);
    }

    #[test]
    fn null_clip_end_parses() {
        let t: Track = serde_json::from_str(r#"{"clipEnd":null}"#).unwrap();
        assert_eq!(t.clip_end, None);
        let t: Track = serde_json::from_str(r#"{"clipEnd":2.0}"#).unwrap();
        assert_eq!(t.clip_end, Some(2.0));
    }

    #[test]
    fn invalid_json_is_invalid_param() {
        assert_eq!(Project::from_json("{").unwrap_err().code(), "ERR_INVALID_PARAM");
        assert_eq!(Project::from_json(r#"{"tracks":5}"#).unwrap_err().code(), "ERR_INVALID_PARAM");
    }

    #[test]
    fn audible_tracks_respect_mute_and_solo() {
        let mut p = Project::default();
        for id in ["a", "b", "c"] {
            p.tracks.push(Track::new(id, "s"));
        }
        let ids = |p: &Project| p.audible_tracks().iter().map(|t| t.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&p), ["a", "b", "c"]);
        p.tracks[1].mute = true;
        assert_eq!(ids(&p), ["a", "c"]);
        p.tracks[2].solo = true;
        assert_eq!(ids(&p), ["c"]);
        // A muted solo track does not activate solo mode.
        p.tracks[2].mute = true;
        assert_eq!(ids(&p), ["a"]);
        p.tracks[1].solo = true;
        assert_eq!(ids(&p), ["a"], "muted solo tracks stay muted and do not enable solo mode");
        p.tracks[1].mute = false;
        assert_eq!(ids(&p), ["b"]);
    }
}
