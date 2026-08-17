"""Tests for the cloud separation worker.

Everything here runs without a GPU, without RunPod and without the separator
binary, because the properties worth protecting are decisions rather than
arithmetic: that a CPU-only worker refuses the job, that progress is read from
real tqdm output, and that the four raw stems become the two the pipeline
wants.

The one thing these cannot prove is that a GPU is actually used — that is
verified by the handler at runtime and by the connection test, which is the
right place for it.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# The runpod SDK is not installed in the test environment; the handler only
# uses it to report progress and to start the server.
sys.modules.setdefault("runpod", mock.MagicMock())

import handler  # noqa: E402


class TestGpuRequirement:
    """The refusal that gives this worker its reason to exist."""

    def test_refuses_to_run_without_cuda(self):
        # A silent CPU fallback would produce a correct dub, slowly, while
        # billing for a GPU — invisible from outside and the exact problem the
        # cloud path exists to solve.
        with mock.patch.object(
            handler, "gpu_report", return_value={"cuda_available": False, "torch_version": "2.5.0"}
        ):
            with pytest.raises(handler.GpuUnavailable) as error:
                handler.require_gpu()

        assert "CPU" in str(error.value)

    def test_accepts_a_real_gpu(self):
        report = {
            "cuda_available": True,
            "device": "cuda",
            "gpu_name": "NVIDIA RTX A4000",
            "cuda_version": "12.4",
        }
        with mock.patch.object(handler, "gpu_report", return_value=report):
            assert handler.require_gpu()["gpu_name"] == "NVIDIA RTX A4000"

    def test_health_reports_without_refusing(self):
        """A health probe must answer even on a broken worker.

        Otherwise the connection test cannot tell "no GPU" from "endpoint
        unreachable", which are very different problems for a reader to fix.
        """
        with mock.patch.object(
            handler, "gpu_report", return_value={"cuda_available": False, "device": "cpu"}
        ):
            result = handler.handler({"input": {"op": "health"}})

        assert result["ok"] is True
        assert result["gpu"]["cuda_available"] is False


class TestProgressParsing:
    """Read from what tqdm really prints, not from an idea of it."""

    def test_reads_a_real_redraw(self):
        line = "\r 32%|###       | 39/122 [29:19<1:01:53, 44.74s/it]"
        assert handler.parse_progress(line) == (39, 122)

    def test_takes_the_newest_of_several_redraws(self):
        chunk = "\r 1%| | 1/122 [00:35]\r 2%| | 2/122 [01:10]\r 3%| | 3/122 [01:49]"
        assert handler.parse_progress(chunk) == (3, 122)

    def test_ignores_the_rate_beside_the_pair(self):
        # "44.74s/it" is a slash with numbers around it, sitting right next to
        # the thing being parsed.
        assert handler.parse_progress("44.74s/it") is None
        assert handler.parse_progress("[00:00<?, ?it/s]") is None

    def test_ignores_log_lines(self):
        assert handler.parse_progress("INFO - separator - Loading model htdemucs") is None

    def test_rejects_impossible_counts(self):
        assert handler.parse_progress("step 5/1") is None
        assert handler.parse_progress("1/1") is None


class TestStemSelection:
    """Four stems in, two out."""

    def test_finds_the_vocal_stem(self):
        produced = [
            Path("source_(Drums)_htdemucs.wav"),
            Path("source_(Vocals)_htdemucs.wav"),
        ]
        found = handler.find_stem(produced, handler.VOCAL_MARKERS)
        assert found is not None and "Vocals" in found.name

    def test_reports_when_no_vocal_stem_exists(self):
        produced = [Path("source_(Drums)_htdemucs.wav")]
        assert handler.find_stem(produced, handler.VOCAL_MARKERS) is None

    def test_sums_every_non_vocal_stem(self, tmp_path):
        """Demucs has no single instrumental output.

        An earlier version of the local backend looked only for "(Instrumental)"
        and would have called a successful separation empty.
        """
        produced = [
            tmp_path / "s_(Vocals)_htdemucs.wav",
            tmp_path / "s_(Drums)_htdemucs.wav",
            tmp_path / "s_(Bass)_htdemucs.wav",
            tmp_path / "s_(Other)_htdemucs.wav",
        ]
        for path in produced:
            path.write_bytes(b"RIFF")

        with mock.patch.object(handler.subprocess, "run") as run:
            handler.build_background(produced, tmp_path)

        args = run.call_args[0][0]
        # Three inputs summed, and at original level: normalize=0 or the mix
        # comes back a third as loud.
        assert args.count("-i") == 3
        assert "amix=inputs=3:normalize=0" in args

    def test_refuses_when_there_is_no_background(self, tmp_path):
        with pytest.raises(RuntimeError, match="no background stems"):
            handler.build_background([tmp_path / "s_(Vocals)_x.wav"], tmp_path)


class TestJobContract:
    """Keys in, keys out. Never media."""

    def test_requires_the_keys_it_needs(self):
        with mock.patch.object(handler, "require_gpu", return_value={"gpu_name": "x"}):
            with pytest.raises(ValueError, match="input_key"):
                handler.handler({"input": {}})

    def test_explains_a_missing_source_in_terms_of_the_volume(self, tmp_path):
        """The likeliest cause is a misattached volume, so say that.

        "File not found" would send someone looking at their audio instead of
        at the endpoint's storage configuration.
        """
        with mock.patch.object(handler, "require_gpu", return_value={"gpu_name": "x"}), \
             mock.patch.object(handler, "VOLUME_ROOT", tmp_path):
            with pytest.raises(FileNotFoundError, match="volume"):
                handler.handler(
                    {"input": {"input_key": "jobs/x/source.wav", "output_prefix": "jobs/x"}}
                )


class TestSeparatorReport:
    """The fingerprint must describe what actually ran."""

    def test_reads_the_installed_version_rather_than_the_pin(self):
        """A pinned constant would let a drifted image lie.

        The stem cache is keyed on this, so an image whose separator quietly
        moved would serve stems under a fingerprint that does not describe them
        — and nobody would notice until they listened.
        """
        completed = mock.MagicMock(stdout="audio-separator 0.44.5\n")
        with mock.patch.object(handler.subprocess, "run", return_value=completed):
            report = handler.separator_report()

        assert report["version"] == "0.44.5"
        assert report["implementation"] == "python-audio-separator"

    def test_flags_drift_from_the_pin(self, monkeypatch):
        monkeypatch.setenv("ARCIIN_SEPARATOR_VERSION", "0.44.5")
        completed = mock.MagicMock(stdout="audio-separator 0.99.0\n")
        with mock.patch.object(handler.subprocess, "run", return_value=completed):
            report = handler.separator_report()

        # Surfaced rather than swallowed: results from a drifted image should
        # not share a cache with the version it claims to be.
        assert "drift" in report
        assert "0.99.0" in report["drift"]

    def test_says_unknown_rather_than_guessing(self):
        with mock.patch.object(handler.subprocess, "run", side_effect=OSError("missing")):
            assert handler.separator_report()["version"] == "unknown"

    def test_health_reports_the_separator_too(self):
        # The connection test needs it: a healthy GPU running the wrong
        # separator version is still the wrong worker.
        with mock.patch.object(handler, "gpu_report", return_value={"cuda_available": True}):
            result = handler.handler({"input": {"op": "health"}})
        assert "separator" in result
