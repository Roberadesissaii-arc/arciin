# Arciin desktop pairing protocol

This is the server contract for a future Arciin Desktop client.

Do not treat discovery or pairing as user authentication.

```txt
Discovery  →  an Arciin server exists on this network
Pairing    →  this computer is an approved trusted device
User login →  a person is using that trusted device
```

A paired device must still sign in with a normal Arciin account before it can
open files. A normal browser must keep working without pairing.

Protocol version: `1`

This is independent of the Arciin application version.

## 1. Discovery

Public, unauthenticated:

```http
GET /.well-known/arciin
```

The same manifest is also available at `GET /api/.well-known/arciin`.

Response (not wrapped in `{ "data": ... }`):

```json
{
  "service": "arciin",
  "protocolVersion": 1,
  "serverId": "public-uuid",
  "instanceName": "Arciin Home",
  "version": "1.0.1",
  "pairingSupported": true,
  "pairingAvailable": true,
  "webUrl": "http://192.168.1.20",
  "mdns": {
    "serviceType": "_arciin._tcp.local",
    "advertised": false
  }
}
```

`serverId` is a stable public UUID. It is not the license instance id, setup
token, session secret, or any other credential.

Discovery must not include users, emails, libraries, storage paths, disk
topology, license tokens, setup tokens, Redis/database URLs, or session data.

`pairingAvailable` is true after the instance has been claimed.

## 2. Protocol versioning

Constant: `ARCIIN_DEVICE_PROTOCOL_VERSION = 1`

Unknown or newer versions are rejected with `DEVICE_PROTOCOL_UNSUPPORTED`.

## 3. Optional mDNS / DNS-SD

Service type:

```txt
_arciin._tcp.local
```

Suggested TXT:

```txt
protocol=1
path=/.well-known/arciin
```

mDNS is convenience only. Clients must always support a manual address:

- `192.168.x.x`
- `arciin.local`
- `https://arciin.example.com`

On Debian/Ubuntu, `install.sh` and `scripts/docker-setup.sh` install Avahi
when sudo/apt are available and write a persistent host service file:

```txt
/etc/avahi/services/arciin.service
```

That advertisement survives reboot. Re-run the helper after the customer-facing
HTTP port changes:

```bash
bash scripts/advertise-arciin-mdns.sh [port]
```

Docker: advertise `ARCIIN_HTTP_PORT` (default 80). Native: advertise the
configured web port. Never advertise API port 4000.

Docker bridge networking does not reliably propagate multicast. Do not switch
production Compose to host networking for this. Avahi runs on the host, not
inside the API container. If Avahi is missing or cannot be installed, Arciin
still starts and manual connection still works.

## 4. Pairing request

Owner/Admin generates one short-lived PIN in Settings → Devices.

There is at most one active pairing code for the instance. Generating a new
code cancels the previous pending code.

Client claim (unauthenticated, rate-limited):

```http
POST /api/devices/pair
Content-Type: application/json

{
  "code": "482731",
  "name": "Robera Desktop",
  "platform": "windows",
  "deviceType": "desktop",
  "appVersion": "0.1.0",
  "protocolVersion": 1
}
```

Allowed `platform`: `windows` `macos` `linux` `ios` `android` `other`  
Allowed `deviceType`: `desktop` `laptop` `phone` `tablet` `other`  
Name max length: 80

## 5. Pairing response

```json
{
  "data": {
    "device": {
      "id": "...",
      "name": "Robera Desktop",
      "platform": "WINDOWS",
      "deviceType": "DESKTOP",
      "status": "ACTIVE"
    },
    "credential": "<returned once>"
  }
}
```

Store the raw credential in the OS secret store (Windows Credential Manager or
macOS Keychain). Never write it to JSON, localStorage, or a plaintext config
file. The Settings UI never shows it.

The server stores only a SHA-256 hash of this high-entropy credential.

The pairing PIN itself is hashed with Argon2id. It is one-time, 6 digits,
~5 minutes, max 5 failed attempts, then locked. Do not put it in URLs.

## 6. Device bootstrap

```http
POST /api/devices/session
Authorization: Device <credential>
```

This proves “this is a previously paired device.” It is not a user login.

On success the server sets an HttpOnly cookie `arciin_trusted_device`
(`SameSite=Lax`, `Path=/`, `Secure` on HTTPS) and returns minimal device state.

## 7. User authentication

After device bootstrap the user signs in with the existing email/password
flow (`POST /api/auth/login`). If a valid trusted-device context exists, the
resulting `Session.pairedDeviceId` is set.

`Session.deviceId` remains the existing per-browser cookie used to collapse
repeat browser sign-ins. It is not a paired Device row.

Normal browsers keep `pairedDeviceId = null`.

## 8. Session binding

Desktop-authenticated user sessions point at `Device.id`. Revoking that
device deletes those sessions. Unrelated browser sessions stay valid.

## 9. Revocation

Owner/Admin:

```http
POST /api/settings/devices/:deviceId/revoke
```

Effects:

1. `Device.status = REVOKED`
2. `revokedAt` set
3. persistent credential stops working
4. trusted-device cookie/session stops working
5. user sessions with that `pairedDeviceId` are deleted

## 10. Settings API

All of these require a signed-in OWNER or ADMIN session:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/settings/devices` | List active devices + pairing metadata (no PIN) |
| POST | `/api/settings/devices/pairing` | Generate PIN (returned once) |
| DELETE | `/api/settings/devices/pairing` | Cancel pending PIN |
| POST | `/api/settings/devices/:deviceId/revoke` | Revoke |
| PATCH | `/api/settings/devices/:deviceId` | Rename |

MEMBER and VIEWER are rejected server-side. Pairing is not a paid entitlement.

## 11. Error codes

| Code | Meaning |
| --- | --- |
| `PAIRING_CODE_INVALID` | Wrong or missing PIN |
| `PAIRING_CODE_EXPIRED` | PIN past `expiresAt` |
| `PAIRING_CODE_LOCKED` | Too many failed attempts; PIN invalidated |
| `PAIRING_ALREADY_USED` | PIN already claimed |
| `PAIRING_CANCELLED` | PIN cancelled by an admin |
| `DEVICE_REVOKED` | Device is no longer trusted |
| `DEVICE_INVALID` | Unknown or missing device credential |
| `DEVICE_PROTOCOL_UNSUPPORTED` | Client protocol version is not 1 |
| `PAIRING_REQUIRED` | Reserved. Not returned in V1. Browsers must keep working without pairing. |
| `VALIDATION_ERROR` | Payload failed schema checks |
| `UNAUTHENTICATED` | User session required |
| `FORBIDDEN` | Role cannot manage devices |
| `RATE_LIMITED` | Endpoint/IP limit |
| `INSTANCE_NOT_READY` | Instance has not been claimed |

Errors never disclose partial PIN matches.

## 12. Security expectations

- Cryptographically generated 6-digit PIN (`crypto.randomInt`)
- Argon2id for the PIN; SHA-256 for the high-entropy device credential
- One active PIN; claim uses a serializable transaction so only one client wins
- Pair and bootstrap endpoints are rate-limited
- Pairing codes and device credentials are redacted from request logs
- Do not send credentials in query strings
- Do not set `Access-Control-Allow-Origin: *` on the API
- Native HTTP clients do not need browser CORS
- Device auth never grants file access by itself

Computer folder backup is a separate protocol. See `docs/DESKTOP-SYNC-PROTOCOL.md`.
Pairing version stays `1` when backup is added.
