# Ops Brain read-only Performance API

## Scope

This Phase 2B-A endpoint exports PublishOS performance facts over HTTPS. The data direction is PublishOS to an Ops Brain consumer that actively pulls the data.

PublishOS provides facts only. It does not write local Ops Brain files. It does not execute retrospectives. It does not make strategy decisions.

The API does not provide local workspace mapping, report generation, local caching, webhooks, cursors, dashboards, or a multi-platform abstraction.

## Configuration and authentication

Set `OPS_BRAIN_BRIDGE_ENABLED=true` only to enable the endpoint. When enabled, `OPS_BRAIN_BRIDGE_TOKEN` is required and must be at least 32 bytes. When disabled (the default), the endpoint fails closed with `404`. No default token or service address exists.

Send the configured token only as `Authorization: Bearer <configured-token>`. This credential is separate from Admin, Client, Device, and Task JWTs. It authorizes only `GET /v1/integrations/ops-brain/*`; it cannot call PublishOS write APIs.

Deployments are portable: consumers must use deployment configuration and must not rely on a server IP, port, directory, or database type.

## Request

`GET /v1/integrations/ops-brain/performance`

Required query parameters:

- `clientId`: exact PublishOS client identifier.
- `contentRef`: exact tenant-scoped stable content identifier.

Optional `days` is an integer from 1 through 365 and defaults to 7. `contentRef` is never matched by title, inferred, or searched across tenants.

For example, a consumer can request `https://example.com/v1/integrations/ops-brain/performance?clientId=client_example_123&contentRef=2026-07-25_ab61ed09f0a1_example-title&days=7`.

## Response contract

The response uses `schemaVersion: "publishos.ops-brain.performance.v1"`. It contains the matched content, collection status, `latestTotals`, per-post snapshots, and an availability map. All timestamps are UTC ISO 8601 strings.

`latestTotals` is calculated by selecting the newest snapshot for each `PublishedPost` across its full history and then summing those per-post values. It never sums daily cumulative snapshots. Missing nullable values do not invent a platform value; present numbers participate in the sum. Engagement rate is `(likes + comments + shares) / views`, or `0` if views is zero.

`days` filters only `posts[].snapshots`, using `observedAt >= generatedAt - days`; snapshots are ascending by `observedAt`. `latestTotals` remains full-history so a narrow timeline does not falsely show zero totals. At most 5,000 timeline snapshots are returned per request.

`availability` describes current API capability, not whether an individual snapshot has a value. `views`, `likes`, `comments`, and `shares` are `available`. `saves`, `reach`, `impressions`, `completionRate`, `averageWatchTime`, and `commentText` are `unavailable_from_current_api`.

`collection.status` is one of `error`, `collecting`, `success`, or `idle`, with priority in that order across the content's related account bindings. Reauthorization is explicitly reported. Error messages are generic and upstream responses are never included.

## Errors and security

Invalid query parameters return `400` with `invalid_query`; an exact client/content reference miss returns `404` with `ops_brain_content_not_found`; missing, malformed, or incorrect bridge credentials return `401` with `ops_brain_unauthorized`. The normal error envelope is `{ "error": { "code", "message", "requestId" } }`.

The endpoint excludes client passwords and email, account access and refresh tokens, OAuth state, task and device tokens, internal upload URLs and paths, database paths, and raw upstream responses. A snapshot may include only `rawResponseHash`, which is not the raw response.
