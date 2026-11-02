# REOS Guardian Relay

Minimal HTTPS relay for connecting the REOS Production node agent to an external Guardian across isolated domestic networks.

## Required environment

- `RELAY_BRIDGE_TOKEN`: random secret of at least 32 characters.
- `PORT`: supplied by the PaaS when available; fallback is `8080` for OpenShift-compatible routing.

## Health

`GET /health`

The relay carries only bounded Guardian exchange payloads. It is separate from SlipNet and contains no Arvan backup credential.
