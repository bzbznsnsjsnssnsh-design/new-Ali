"""Audio helper utilities shared across TTSFM components."""

from __future__ import annotations

import io
import logging
import shutil
from typing import Iterable, List, Sequence

from .exceptions import AudioProcessingException
from .models import TTSResponse

logger = logging.getLogger(__name__)


try:  # Optional dependency for non-WAV combining
    from pydub import AudioSegment
except ImportError:  # pragma: no cover - optional dependency
    AudioSegment = None


# Detect ffmpeg availability at runtime
FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None

SUPPORTED_EXPORT_FORMATS = {"mp3", "wav", "aac", "flac", "opus", "pcm"}


def combine_audio_chunks(audio_chunks: Iterable[bytes], format_type: str = "mp3") -> bytes:
    """Combine multiple audio chunks into a single audio file.

    Args:
        audio_chunks: Iterable of raw audio byte strings
        format_type: Requested output format

    Returns:
        Combined audio data as bytes

    Raises:
        RuntimeError: If non-WAV combining is requested without pydub/ffmpeg available
    """

    chunks_list = list(audio_chunks)
    if not chunks_list:
        return b""

    fmt = format_type.lower()

    # Check for pydub availability (which requires ffmpeg for MP3)
    if AudioSegment is None:
        if fmt == "mp3":
            raise AudioProcessingException(
                "Combining MP3 audio requires pydub and ffmpeg. "
                "Install ttsfm[web] and use the full Docker image (dbcccc/ttsfm:latest) "
                "instead of the slim variant.",
                audio_format="mp3",
            )
        return _simple_wav_concatenation(chunks_list)

    # Check for ffmpeg availability when using pydub
    if not FFMPEG_AVAILABLE and fmt == "mp3":
        raise AudioProcessingException(
            "MP3 auto-combine requires ffmpeg. "
            "Use the full Docker image (dbcccc/ttsfm:latest) instead of the slim variant, "
            "or disable auto_combine and handle chunks separately.",
            audio_format="mp3",
        )

    audio_segments = []
    for chunk in chunks_list:
        buffer = io.BytesIO(chunk)
        if fmt == "mp3":
            segment = AudioSegment.from_mp3(buffer)
        else:
            segment = AudioSegment.from_wav(buffer)
        audio_segments.append(segment)

    combined = audio_segments[0]
    for segment in audio_segments[1:]:
        combined += segment

    output_buffer = io.BytesIO()
    export_format = "mp3" if fmt == "mp3" else "wav"
    combined.export(output_buffer, format=export_format)
    return output_buffer.getvalue()


def _simple_wav_concatenation(wav_chunks: List[bytes]) -> bytes:
    """Simple WAV concatenation fallback that avoids external deps."""
    if not wav_chunks:
        return b""

    if len(wav_chunks) == 1:
        return wav_chunks[0]

    try:
        first_wav = wav_chunks[0]
        if len(first_wav) < 44:
            return b"".join(wav_chunks)

        header = bytearray(first_wav[:44])
        audio_data = first_wav[44:]

        for wav_chunk in wav_chunks[1:]:
            if len(wav_chunk) > 44:
                audio_data += wav_chunk[44:]

        total_size = len(header) + len(audio_data) - 8
        header[4:8] = total_size.to_bytes(4, byteorder="little")

        data_size = len(audio_data)
        header[40:44] = data_size.to_bytes(4, byteorder="little")

        return bytes(header) + audio_data
    except Exception as exc:
        logger.error("Error in simple WAV concatenation: %s", exc)
        return b"".join(wav_chunks)


def combine_responses(responses: Sequence["TTSResponse"]) -> "TTSResponse":
    """Combine multiple ``TTSResponse`` objects into a single response."""

    responses = list(responses)
    if not responses:
        raise ValueError("No responses provided for combination")

    first = responses[0]
    audio_format = first.format

    audio_bytes = combine_audio_chunks((resp.audio_data for resp in responses), audio_format.value)

    total_duration = None
    if any(resp.duration is not None for resp in responses):
        total_duration = sum(filter(None, (resp.duration for resp in responses)))

    metadata = dict(first.metadata or {})
    metadata.update(
        {
            "chunks_combined": len(responses),
            "auto_combined": True,
        }
    )

    return TTSResponse(
        audio_data=audio_bytes,
        content_type=first.content_type,
        format=audio_format,
        size=len(audio_bytes),
        duration=total_duration if total_duration is not None else first.duration,
        metadata=metadata,
    )
