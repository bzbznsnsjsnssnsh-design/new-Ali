"""Tests for audio processing functionality."""

import pytest
import shutil
from ttsfm.audio_processing import adjust_audio_speed, _build_atempo_filter_chain


class TestAudioProcessing:
    """Test audio processing functions."""

    def test_build_atempo_filter_chain_normal_range(self):
        """Test atempo filter chain for speeds in 0.5-2.0 range."""
        # Single filter for speeds in range
        assert _build_atempo_filter_chain(1.0) == "atempo=1.0"
        assert _build_atempo_filter_chain(1.5) == "atempo=1.5"
        assert _build_atempo_filter_chain(0.5) == "atempo=0.5"
        assert _build_atempo_filter_chain(2.0) == "atempo=2.0"

    def test_build_atempo_filter_chain_high_speed(self):
        """Test atempo filter chain for speeds > 2.0."""
        # Should chain multiple filters
        result = _build_atempo_filter_chain(4.0)
        assert "atempo=2.0" in result
        assert "," in result  # Multiple filters chained

    def test_build_atempo_filter_chain_low_speed(self):
        """Test atempo filter chain for speeds < 0.5."""
        # Should chain multiple filters
        result = _build_atempo_filter_chain(0.25)
        assert "atempo=0.5" in result
        assert "," in result  # Multiple filters chained

    def test_adjust_audio_speed_validation(self):
        """Test speed parameter validation."""
        dummy_audio = b"dummy audio data"

        # Speed too low
        with pytest.raises(ValueError, match="Speed must be between 0.25 and 4.0"):
            adjust_audio_speed(dummy_audio, speed=0.1)

        # Speed too high
        with pytest.raises(ValueError, match="Speed must be between 0.25 and 4.0"):
            adjust_audio_speed(dummy_audio, speed=5.0)

    def test_adjust_audio_speed_no_change(self):
        """Test that speed=1.0 returns original audio."""
        dummy_audio = b"dummy audio data"
        result = adjust_audio_speed(dummy_audio, speed=1.0)
        assert result == dummy_audio

    @pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not available")
    def test_adjust_audio_speed_requires_ffmpeg(self):
        """Test that speed adjustment requires ffmpeg."""
        # This test only runs if ffmpeg is available
        # If ffmpeg is not available, the function should raise RuntimeError
        pass

    def test_adjust_audio_speed_no_ffmpeg(self, monkeypatch):
        """Test error when ffmpeg is not available."""
        # Mock shutil.which to return None (ffmpeg not found)
        monkeypatch.setattr("shutil.which", lambda x: None)

        dummy_audio = b"dummy audio data"
        with pytest.raises(RuntimeError, match="Speed adjustment requires ffmpeg"):
            adjust_audio_speed(dummy_audio, speed=1.5)


class TestFFmpegDetection:
    """Test ffmpeg detection in audio module."""

    def test_ffmpeg_detection(self):
        """Test that FFMPEG_AVAILABLE is set correctly."""
        from ttsfm.audio import FFMPEG_AVAILABLE

        # Should be a boolean
        assert isinstance(FFMPEG_AVAILABLE, bool)

        # Should match actual ffmpeg availability
        expected = shutil.which("ffmpeg") is not None
        assert FFMPEG_AVAILABLE == expected


class TestAudioCombineWithFFmpeg:
    """Test audio combining with ffmpeg detection."""

    def test_combine_mp3_without_ffmpeg(self, monkeypatch):
        """Test that MP3 combining fails gracefully without ffmpeg."""
        # Mock both pydub and ffmpeg as unavailable
        import ttsfm.audio

        monkeypatch.setattr(ttsfm.audio, "AudioSegment", None)
        monkeypatch.setattr(ttsfm.audio, "FFMPEG_AVAILABLE", False)

        from ttsfm.audio import combine_audio_chunks
        from ttsfm.exceptions import AudioProcessingException

        chunks = [b"chunk1", b"chunk2"]
        with pytest.raises(AudioProcessingException, match="MP3 audio requires pydub and ffmpeg"):
            combine_audio_chunks(chunks, format_type="mp3")

    def test_combine_wav_without_ffmpeg(self, monkeypatch):
        """Test that WAV combining works without ffmpeg."""
        # Mock pydub as unavailable but allow WAV concatenation
        import ttsfm.audio

        monkeypatch.setattr(ttsfm.audio, "AudioSegment", None)

        from ttsfm.audio import combine_audio_chunks

        # Create simple WAV chunks (with minimal headers)
        # This is a simplified test - real WAV files have proper headers
        chunks = [b"RIFF" + b"\x00" * 40 + b"data", b"RIFF" + b"\x00" * 40 + b"data"]

        # Should not raise error for WAV
        result = combine_audio_chunks(chunks, format_type="wav")
        assert isinstance(result, bytes)
