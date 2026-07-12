# Changelog

All notable Aloom changes are documented here.

## Unreleased

### Added

- Aloom GEO Detection Pack v1.1 with 54 fixed templates per language.
- Six deterministic suites and three independent sampling depths.
- Persistent task-bound Camoufox profiles for Doubao, DeepSeek, Yuanbao, and Qwen.
- Official provider mode selection and verification.
- Per-answer strict-Schema analysis with deterministic hierarchical reports.
- Weekly and monthly frozen detection schedules.
- Repository language and privacy build gates.

### Changed

- Product scope is detection and recurring monitoring only.
- Aloom is licensed under Apache-2.0; upstream MIT notices remain intact.
- Normal provider collection is headless and becomes visible only for explicit inspection or human verification.
- Self-hosted deployments run the control and data planes; official Web sessions remain on a paired user computer.

### Removed

- Arbitrary custom prompts from formal detection.
- Optimization, content generation, publishing, and intervention flows from the active product.
- Provider auth-session upload and server-side cookie storage.
- VPS browser collection and automatic proxy rotation.
