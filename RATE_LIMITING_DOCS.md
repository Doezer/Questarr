# Rate Limiting and Input Sanitization Implementation

## Overview

This implementation adds comprehensive rate limiting and input sanitization to the GameRadarr API to improve security, prevent abuse, and protect against IGDB API blacklisting.

## Rate Limiting Strategy

### General API Limiter
- **Applied to:** All `/api/*` routes
- **Limit:** 100 requests per minute per IP
- **Purpose:** Prevent general API abuse while allowing reasonable usage

### IGDB API Limiter
- **Applied to:** All IGDB endpoints (`/api/igdb/*`, `/api/games/discover`)
- **Limit:** 3 requests per second per IP
- **Purpose:** Prevent blacklisting from IGDB (which has a 4 requests/second limit)
- **Endpoints protected:**
  - `/api/igdb/search` - Search IGDB for games
  - `/api/igdb/popular` - Get popular games
  - `/api/igdb/recent` - Get recent releases
  - `/api/igdb/upcoming` - Get upcoming releases
  - `/api/igdb/game/:id` - Get game details
  - `/api/games/discover` - Get personalized recommendations

### Sensitive Endpoint Limiter
- **Applied to:** All write operations (POST, PATCH, DELETE)
- **Limit:** 30 requests per minute per IP
- **Purpose:** Prevent abuse of data modification operations
- **Endpoints protected:**
  - Game operations: add, update status, delete
  - Indexer operations: add, update, delete
  - Downloader operations: add, update, delete
  - Torrent operations: add

## Input Sanitization

### Search Queries
- Trimmed and escaped
- Maximum length: 200 characters
- Applied to: `/api/games/search`, `/api/igdb/search`

### ID Validation

#### Game IDs
- Format: UUID (e.g., `123e4567-e89b-12d3-a456-426614174000`)
- Applied to: `/api/games/:id/*`

#### IGDB IDs
- Format: Positive integer
- Applied to: `/api/igdb/game/:id`

### Game Data Validation
- **Title:** 1-500 characters, trimmed, escaped
- **IGDB ID:** Optional positive integer
- **Summary:** Optional, max 5000 characters, trimmed, escaped
- **Cover URL:** Optional, valid URL format
- **Release Date:** Optional, format `YYYY-MM-DD`
- **Rating:** Optional, 0-10 range
- **Platforms:** Optional array, each item max 100 characters
- **Genres:** Optional array, each item max 100 characters

### Game Status Validation
- Whitelist: `wanted`, `owned`, `completed`, `playing`
- Rejects any other values

### Indexer Data Validation
- **Name:** 1-200 characters, trimmed, escaped
- **URL:** Valid URL format
- **API Key:** Optional, max 500 characters
- **Enabled:** Optional boolean

### Downloader Data Validation
- **Name:** 1-200 characters, trimmed, escaped
- **Type:** Whitelist: `qbittorrent`, `transmission`, `deluge`
- **URL:** Valid URL format
- **Username:** Optional, max 200 characters
- **Password:** Optional, max 200 characters
- **Enabled:** Optional boolean

### Torrent Data Validation
- **URL:** Valid URL format (for torrent file or magnet link)
- **Title:** 1-500 characters, trimmed, escaped
- **Category:** Optional, max 100 characters
- **Download Path:** Optional, max 500 characters
- **Priority:** Optional, 0-10 range

## Security Benefits

1. **XSS Prevention:** Input escaping prevents cross-site scripting attacks
2. **IGDB Protection:** Conservative rate limiting prevents API blacklisting
3. **Abuse Prevention:** Rate limiting on write operations prevents spam
4. **Data Integrity:** Validation ensures only valid data enters the system
5. **SQL Injection Protection:** Combined with Drizzle ORM's parameterized queries

## Testing

- 22 new unit tests covering all sanitization validators
- All tests verify both valid and invalid inputs
- Tests cover edge cases (empty strings, too long, wrong format, etc.)
- 30 total tests passing

## Dependencies Added

- `express-rate-limit@^8.2.1` - Rate limiting middleware
- `express-validator@^7.3.0` - Input validation and sanitization

## Implementation Notes

### Middleware Order
Middleware is applied in the following order:
1. Rate limiting (if applicable)
2. Input sanitization validators
3. Validation result check (`validateRequest`)
4. Route handler

### Error Responses
Invalid requests return:
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "fieldName",
      "message": "Error message"
    }
  ]
}
```

Rate limit exceeded returns:
```json
{
  "error": "Too many requests, please try again later"
}
```

### Rate Limit Headers
The following headers are added to rate-limited responses:
- `RateLimit-Limit`: Maximum requests allowed in the window
- `RateLimit-Remaining`: Remaining requests in the current window
- `RateLimit-Reset`: Time when the rate limit resets

## Future Improvements

Potential enhancements for future iterations:
1. Store-based rate limiting (Redis) for distributed systems
2. User-based rate limiting (currently IP-based)
3. Dynamic rate limits based on user role/subscription
4. More granular rate limits per endpoint
5. Rate limit bypass for authenticated admin users
