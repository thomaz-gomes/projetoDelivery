# ViaCEP Address Quality Integration

**Date**: 2026-04-04
**Status**: Approved

## Problem

Address geocoding fails frequently because users type addresses with typos, missing neighborhoods, or ambiguous street names. Nominatim (OpenStreetMap) has poor coverage of Brazilian streets, resulting in pins in the ocean or wrong cities.

## Solution

Add optional CEP (postal code) field as the first field in all address forms. When filled, auto-populate street, neighborhood, city, and state via ViaCEP (free, unlimited API). Validate neighborhood against the store's registered delivery areas — if not found, show "we don't deliver to this area" and block delivery order.

## Flow

1. User types CEP (8 digits)
2. On complete (8 chars) or blur, call `GET /utils/cep/:cep`
3. Backend proxies to `viacep.com.br/ws/{cep}/json/`
4. Returns: `logradouro`, `bairro`, `cidade`, `estado`, `cep`
5. Auto-fill street, city, state fields
6. Match `bairro` against store's registered neighborhoods (case-insensitive):
   - **Found**: auto-select, show delivery fee
   - **Not found**: show "Não entregamos nesse bairro" warning, block checkout for delivery
7. All fields remain editable (CEP is optional, not blocking)

## Points of Change

### Backend

- **New endpoint**: `GET /utils/cep/:cep` — proxy to ViaCEP, returns normalized response
- Simple proxy, no DB, no auth required (public endpoint)

### Frontend (5 address forms)

| File | Who uses | Change |
|------|----------|--------|
| `PublicMenu.vue` (checkout) | Customer | CEP field + auto-fill + neighborhood validation |
| `POSOrderWizard.vue` (PDV) | Operator | CEP field + auto-fill + neighborhood validation |
| `PublicAddresses.vue` | Customer | CEP field + auto-fill (no neighborhood validation — just saving address) |
| `CustomerForm.vue` | Admin | CEP field + auto-fill |
| `StoreForm.vue` | Admin | CEP field + auto-fill city/state |

### Shared

- **New composable**: `useCepLookup()` — shared logic for CEP fetch, field mapping, loading state
- Used by all 5 forms to avoid duplication

## What Does NOT Change

- Neighborhood/delivery fee system
- Geocoding pipeline (Nominatim + fallback)
- Database schema (CustomerAddress, Order, Store)
- No field becomes mandatory

## API Response Shape

```json
// GET /utils/cep/45820970
{
  "cep": "45820-970",
  "logradouro": "Avenida Tordesilhas",
  "bairro": "Dinah Borges",
  "cidade": "Eunápolis",
  "estado": "BA"
}

// GET /utils/cep/00000000
{ "error": "CEP não encontrado" }
```
