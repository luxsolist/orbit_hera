# E2E Input And Render Refactor Design

## Goal

Stabilize the e2e smoke test while improving the shape of the input-lock and render-validation code.

## Scope

- Treat pointer lock as a best-effort browser capability instead of an unhandled side effect.
- Keep `Input` responsible for browser input APIs, but move request error handling into a small testable helper.
- Keep `Game` behavior unchanged for real play, except avoiding unhandled pointer-lock promise rejections.
- Replace the e2e PNG-byte-size heuristic with explicit screenshot pixel analysis.
- Extract repeated e2e actions into local helpers inside the smoke script.

## Design

`Input.requestLock()` will return a `Promise<boolean>` and internally use a helper that catches both synchronous and asynchronous pointer-lock failures. Callers may ignore the boolean when pointer lock is optional, but no rejected promise should leak into global diagnostics.

The e2e smoke script will keep using Playwright directly, but repeated console capture, screenshot capture, and map deployment steps will be expressed as local helper functions. The render assertion will inspect decoded screenshot pixels and verify that the capture is not black/blank, instead of relying on compressed PNG size.

This is intentionally a narrow refactor. Larger `Game` decomposition into session builders or loop controllers is deferred until there is a feature change that benefits from it.
