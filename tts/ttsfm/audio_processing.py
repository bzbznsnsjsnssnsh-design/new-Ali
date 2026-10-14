"""Audio processing utilities using ffmpeg for advanced features."""

from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def adjust_audio_speed(
    audio_data: bytes,
    speed: float,
    input_format: str = "mp3",
    output_format: str = "mp3",
) -> bytes:
    """
    Adjust audio playback speed using ffmpeg.

    Args:
        audio_data: Input audio data as bytes
        speed: Speed multiplier (0.25 to 4.0). 1.0 = normal speed, 2.0 = 2x faster
        input_format: Input audio format (mp3, wav, etc.)
        output_format: Output audio format (mp3, wav, etc.)

    Returns:
        Processed audio data as bytes

    Raises:
        RuntimeError: If ffmpeg is not available or processing fails
        ValueError: If speed is out of valid range
    """
    # Validate speed range (OpenAI TTS API supports 0.25 to 4.0)
    if not 0.25 <= speed <= 4.0:
        raise ValueError(f"Speed must be between 0.25 and 4.0, got {speed}")

    # If speed is 1.0, no processing needed
    if speed == 1.0:
        return audio_data

    # Check ffmpeg availability
    import shutil

    if not shutil.which("ffmpeg"):
        raise RuntimeError(
            "Speed adjustment requires ffmpeg. "
            "Use the full Docker image (dbcccc/ttsfm:latest) instead of the slim variant."
        )

    try:
        # Create temporary files for input and output
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            input_file = tmp_path / f"input.{input_format}"
            output_file = tmp_path / f"output.{output_format}"

            # Write input audio to temp file
            input_file.write_bytes(audio_data)

            # Build ffmpeg command
            # For speed adjustment, we use the atempo filter
            # atempo only supports 0.5-2.0 range, so we may need to chain filters
            atempo_filters = _build_atempo_filter_chain(speed)

            cmd = [
                "ffmpeg",
                "-i",
                str(input_file),
                "-filter:a",
                atempo_filters,
                "-y",  # Overwrite output file
                "-loglevel",
                "error",  # Only show errors
                str(output_file),
            ]

            # Run ffmpeg
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode != 0:
                logger.error(f"ffmpeg error: {result.stderr}")
                raise RuntimeError(f"ffmpeg processing failed: {result.stderr}")

            # Read processed audio
            return output_file.read_bytes()

    except subprocess.TimeoutExpired:
        raise RuntimeError("Audio processing timed out")
    except Exception as e:
        logger.error(f"Error adjusting audio speed: {e}")
        raise RuntimeError(f"Failed to adjust audio speed: {e}")


def _build_atempo_filter_chain(speed: float) -> str:
    """
    Build atempo filter chain for ffmpeg.

    The atempo filter only supports 0.5-2.0 range, so for speeds outside
    this range, we need to chain multiple atempo filters.

    Args:
        speed: Target speed multiplier

    Returns:
        Filter string for ffmpeg
    """
    if 0.5 <= speed <= 2.0:
        return f"atempo={speed}"

    # For speeds outside 0.5-2.0, chain multiple atempo filters
    filters = []
    remaining_speed = speed

    while remaining_speed > 2.0:
        filters.append("atempo=2.0")
        remaining_speed /= 2.0

    while remaining_speed < 0.5:
        filters.append("atempo=0.5")
        remaining_speed /= 0.5

    if remaining_speed != 1.0:
        filters.append(f"atempo={remaining_speed}")

    return ",".join(filters)


def convert_audio_format(
    audio_data: bytes,
    input_format: str,
    output_format: str,
    bitrate: Optional[str] = None,
) -> bytes:
    """
    Convert audio from one format to another using ffmpeg.

    Args:
        audio_data: Input audio data as bytes
        input_format: Input audio format (mp3, wav, opus, aac, flac, pcm)
        output_format: Output audio format (mp3, wav, opus, aac, flac, pcm)
        bitrate: Optional bitrate for output (e.g., "128k", "192k")

    Returns:
        Converted audio data as bytes

    Raises:
        RuntimeError: If ffmpeg is not available or conversion fails
    """
    # Check ffmpeg availability
    import shutil

    if not shutil.which("ffmpeg"):
        raise RuntimeError(
            "Format conversion requires ffmpeg. "
            "Use the full Docker image (dbcccc/ttsfm:latest) instead of the slim variant."
        )

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            input_file = tmp_path / f"input.{input_format}"
            output_file = tmp_path / f"output.{output_format}"

            # Write input audio to temp file
            input_file.write_bytes(audio_data)

            # Build ffmpeg command
            cmd = [
                "ffmpeg",
                "-i",
                str(input_file),
                "-y",  # Overwrite output file
                "-loglevel",
                "error",
            ]

            # Add bitrate if specified
            if bitrate:
                cmd.extend(["-b:a", bitrate])

            # Add output format-specific options
            if output_format == "opus":
                cmd.extend(["-c:a", "libopus"])
            elif output_format == "aac":
                cmd.extend(["-c:a", "aac"])
            elif output_format == "flac":
                cmd.extend(["-c:a", "flac"])
            elif output_format == "pcm":
                cmd.extend(["-f", "s16le", "-acodec", "pcm_s16le"])

            cmd.append(str(output_file))

            # Run ffmpeg
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode != 0:
                logger.error(f"ffmpeg error: {result.stderr}")
                raise RuntimeError(f"ffmpeg conversion failed: {result.stderr}")

            # Read converted audio
            return output_file.read_bytes()

    except subprocess.TimeoutExpired:
        raise RuntimeError("Audio conversion timed out")
    except Exception as e:
        logger.error(f"Error converting audio format: {e}")
        raise RuntimeError(f"Failed to convert audio format: {e}")
