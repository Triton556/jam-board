use crate::{Result, err};

pub(crate) const MAX_WAV_BYTES: usize = 120 * 16_000 * 2 + 65_536;

/// Accept PCM WAV with optional RIFF metadata chunks, never encoded audio.
pub fn validate_wav(wav: &[u8]) -> Result<u64> {
    if wav.len() < 44 || wav.len() > MAX_WAV_BYTES {
        return Err(err("WAV must contain at most 120 seconds of audio"));
    }
    if &wav[..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err(err("Expected a PCM WAV file"));
    }
    let u32_at = |i| u32::from_le_bytes(wav[i..i + 4].try_into().unwrap()) as usize;
    if u32_at(4).checked_add(8) != Some(wav.len()) {
        return Err(err("WAV RIFF length does not match its contents"));
    }
    let mut offset = 12usize;
    let mut format = false;
    let mut samples = None;
    while offset + 8 <= wav.len() {
        let length = u32_at(offset + 4);
        let start = offset + 8;
        let end = start
            .checked_add(length)
            .filter(|&e| e <= wav.len())
            .ok_or_else(|| err("Truncated WAV chunk"))?;
        match &wav[offset..offset + 4] {
            b"fmt " => {
                if format || length < 16 {
                    return Err(err("Invalid WAV format chunk"));
                }
                let chunk = &wav[start..end];
                let u16_at = |i| u16::from_le_bytes(chunk[i..i + 2].try_into().unwrap());
                if u16_at(0) != 1
                    || u16_at(2) != 1
                    || u32::from_le_bytes(chunk[4..8].try_into().unwrap()) != 16_000
                    || u32::from_le_bytes(chunk[8..12].try_into().unwrap()) != 32_000
                    || u16_at(12) != 2
                    || u16_at(14) != 16
                {
                    return Err(err("WAV must be 16 kHz, mono, 16-bit PCM"));
                }
                format = true;
            }
            b"data" => {
                if !format
                    || samples.is_some()
                    || length == 0
                    || length % 2 != 0
                    || length > 120 * 32_000
                {
                    return Err(err("Invalid WAV audio data (maximum 120 seconds)"));
                }
                samples = Some(length);
            }
            _ => {}
        }
        offset = end + length % 2;
    }
    if offset != wav.len() || !format {
        return Err(err("Invalid WAV chunks"));
    }
    samples
        .map(|n| n as u64 * 1000 / 32_000)
        .ok_or_else(|| err("WAV has no audio data"))
}
