# Contributing to TTSFM

Thanks for your interest in improving TTSFM! This document outlines the local development workflow and quality gates that every pull request must satisfy.

## 1. Set Up Your Environment

```bash
# Clone and create a virtual environment of your choice
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install the package with all tooling and web extras
pip install -e .[web,dev]
```

## 2. Run the Test Suite

```bash
pytest
```

Add new tests alongside your changes—patches without coverage for new behaviour will be sent back for revision.

## 3. Lint and Type-Check

We keep the codebase consistent and catch regressions early with these checks:

```bash
black --check ttsfm ttsfm-web tests
flake8 ttsfm ttsfm-web
mypy ttsfm
```

Format your code with `black` and resolve lint/type errors before opening a pull request.

## 4. Web UI Smoke Tests

If you touch the Flask app or frontend assets, run the web server locally and exercise the basic flows (text input, long-form combine, WebSocket streaming). For asynchronous features, open two browser tabs and confirm cancellation works.

## 5. Commit & Pull Request Guidelines

- Keep commits focused; squash trivial fixups before submitting.
- Describe _why_ a change is needed in the PR description.
- Link to an issue if one exists.
- Document behaviour changes in `CHANGELOG.md` when relevant.

Questions or ideas? Open a discussion thread or drop by the issue tracker—we’re happy to help.
